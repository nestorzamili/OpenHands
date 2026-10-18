#!/usr/bin/env python3
"""Root-run WebGen control service.  All external commands use fixed argv vectors."""
from __future__ import annotations
import errno
import logging
import stat
import base64, copy, hashlib, json, os, re, secrets, shutil, socket, subprocess, tempfile, threading, time, uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from webgen_migrations import MigrationError, MigrationRunner, collect_project_migrations
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
import yaml
logger=logging.getLogger("webgen-control")

def project_database_name(slug):
    if not valid_slug(slug): raise ValueError("invalid project slug")
    name="dck_"+slug
    if len(name.encode("ascii"))<=63: return name
    suffix=hashlib.sha256(slug.encode("ascii")).hexdigest()[:16]
    return name[:63-len(suffix)-1]+"_"+suffix

def runtime_database_role(slug):
    if not valid_slug(slug): raise ValueError("invalid project slug")
    return "dck_runtime_"+hashlib.sha256(slug.encode("ascii")).hexdigest()[:32]

def migration_database_role(slug):
    if not valid_slug(slug): raise ValueError("invalid project slug")
    return "dck_migrate_"+hashlib.sha256(slug.encode("ascii")).hexdigest()[:32]

SLUG_RE=re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CONV_RE=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
DNS_RE=re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
EMAIL_RE=re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RESERVED={"agent","www","api","mail","smtp","ftp","admin","root","ns1","ns2","localhost"}
SECRET_NAME_RE=re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
ENV_KEY_RE=re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ENV_LINE_RE=re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
ACTIONS={"deploy","rebuild","start","restart","stop","delete","publish","unpublish"}; MAX_BODY=16*1024; UTC=timezone.utc

class WebgenOperationError(RuntimeError):
    def __init__(self, code, status=500):
        super().__init__(code); self.code=code; self.status=status

class OwnerSeedUnavailable(WebgenOperationError):
    def __init__(self): super().__init__("owner_authorization_required", 410)

class SecretMaterializationError(RuntimeError):
    def __init__(self,message,status=422,code="secrets_required"):
        super().__init__(message); self.status=status; self.code=code

class EnvironmentReviewRequired(WebgenOperationError):
    def __init__(self,source):
        super().__init__("environment_manual_review_required",409); self.source=source

class RuntimeSecretStoreUnavailable(RuntimeError):
    """Raised after persistence becomes uncertain and the store is locked."""

class QuarantineDurabilityError(OSError):
    """The workspace unlink happened, but its directory entry was not synced."""

def valid_slug(s): return isinstance(s,str) and bool(SLUG_RE.fullmatch(s))
def valid_conversation(s): return isinstance(s,str) and bool(CONV_RE.fullmatch(s))
def valid_subdomain(s): return isinstance(s,str) and bool(DNS_RE.fullmatch(s)) and s not in RESERVED
def now_iso(): return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00","Z")
def canonical_signed_payload(version,slug,conversation_id,issued_at,expires_at,nonce,email,username,password): return json.dumps([version,slug,conversation_id,issued_at,expires_at,nonce,email,username,password],ensure_ascii=False,separators=(",",":")).encode()
def atomic_json(path,obj):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink(): raise ValueError("invalid metadata path")
    current=path.parent.stat()
    tmp=path.with_name(path.name+".tmp-"+secrets.token_hex(8))
    try:
        with open(tmp,"w",encoding="utf-8") as f: json.dump(obj,f,ensure_ascii=False,indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.chown(tmp,current.st_uid,current.st_gid); os.chmod(tmp,0o644); os.replace(tmp,path)
    finally: tmp.unlink(missing_ok=True)
def safe_project(root,slug):
    if not valid_slug(slug): return None
    c=root/slug
    try:
        if not c.is_dir() or c.is_symlink(): return None
        rr=root.resolve(); cr=c.resolve(); return cr if cr.parent==rr else None
    except OSError: return None
def canonical_project(root,slug): return safe_project(root,slug) if valid_slug(slug) and (root/slug).exists() else None
def command_for(slug,action,compose_file,project_dir=None):
    if not valid_slug(slug) or action not in ACTIONS-{"publish","unpublish"}: raise ValueError("invalid operation")
    base=["docker","compose","-p",slug,"-f",str(compose_file)]
    if project_dir is not None: base.extend(["--project-directory",str(project_dir)])
    return base+{"deploy":["up","-d","--build"],"rebuild":["up","-d","--build"],"start":["up","-d"],"restart":["up","-d"],"stop":["down","--remove-orphans"],"delete":["down","-v","--rmi","local"]}[action]
def _master_key(path):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(path.parent,0o700)
    if path.is_symlink(): raise RuntimeError("invalid master key")
    try:
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(fd,secrets.token_bytes(32)); os.fsync(fd); os.close(fd)
    except FileExistsError: pass
    os.chmod(path,0o600)
    if path.stat().st_uid!=os.geteuid() or path.stat().st_mode & 0o077: raise RuntimeError("invalid master key permissions")
    key=path.read_bytes()
    if len(key)!=32: raise RuntimeError("invalid master key")
    return key
@dataclass
class StoredSeed: slug:str; conversation:str; nonce:str; issued:int; expires:int; blob:bytes; authorized_until:int=0
class SeedStore:
    def __init__(self,ttl=900,max_records=128,master_path=None):
        self.ttl=min(max(1,int(ttl)),900); self.max_records=max_records; self.aead=AESGCM(AESGCM.generate_key(256)); self.master=_master_key(master_path or os.getenv("WEBGEN_CONTROL_KEY","/var/lib/dck-webgen-control/webgen-control.key")); self.lock=threading.Lock(); self.records={}
    def private_for(self,slug): return Ed25519PrivateKey.from_private_bytes(HKDF(algorithm=hashes.SHA256(),length=32,salt=b"webgen-control-ed25519",info=("slug:"+slug).encode()).derive(self.master))
    def public_key(self,slug): return base64.b64encode(self.private_for(slug).public_key().public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)).decode()
    def _drop(self):
        t=int(time.time()); self.records={k:v for k,v in self.records.items() if v.expires>=t and (not v.authorized_until or v.authorized_until>=t)}
    def stage(self,slug,conversation,email,username,password):
        if not valid_slug(slug) or not valid_conversation(conversation) or not isinstance(email,str) or len(email)>320 or not EMAIL_RE.fullmatch(email) or not isinstance(password,str): raise ValueError("invalid credentials")
        if not 15<=len(password.encode("utf-16-le"))//2<=1024 or username is not None and (not isinstance(username,str) or len(username)>255): raise ValueError("invalid credentials")
        with self.lock:
            self._drop()
            if len(self.records)>=self.max_records: raise OverflowError("seed capacity")
            issued=int(time.time()); nonce=secrets.token_urlsafe(24); iv=secrets.token_bytes(12); plain=json.dumps([email,username,password],ensure_ascii=False,separators=(",",":")).encode(); self.records[(slug,conversation)]=StoredSeed(slug,conversation,nonce,issued,issued+self.ttl,iv+self.aead.encrypt(iv,plain,(slug+"\0"+conversation).encode()))
            return {"status":"staged","expires_at":issued+self.ttl,"verification_key":self.public_key(slug)}
    def authorized(self,slug,conversation):
        with self.lock: self._drop(); r=self.records.get((slug,conversation)); return bool(r and r.authorized_until>=int(time.time()))
    def authorize(self,slug,conversation):
        with self.lock:
            self._drop(); r=self.records.get((slug,conversation))
            if not r: raise OwnerSeedUnavailable()
            r.authorized_until=min(r.expires,int(time.time())+300); return {"status":"authorized"}
    def peek(self,slug,conversation):
        with self.lock:
            self._drop(); r=self.records.get((slug,conversation))
            if not r or r.expires<int(time.time()) or r.authorized_until<int(time.time()): raise OwnerSeedUnavailable()
            plain=self.aead.decrypt(r.blob[:12],r.blob[12:],(slug+"\0"+conversation).encode()); e,u,p=json.loads(plain.decode()); return r,e,u,p
    def consume(self,slug,conversation):
        with self.lock:
            r=self.records.get((slug,conversation));
            if not r or r.expires<int(time.time()) or r.authorized_until<int(time.time()): raise OwnerSeedUnavailable()
            plain=self.aead.decrypt(r.blob[:12],r.blob[12:],(slug+"\0"+conversation).encode()); e,u,p=json.loads(plain.decode())
            self.records.pop((slug,conversation),None); return r,e,u,p

class RuntimeSecretStore:
    """Encrypted host-side store; list metadata never contains values."""
    MAGIC=b"WGRS1"; AAD=b"webgen-runtime-secrets-v1"; MAX_BYTES=8*1024*1024; MAX_SECRETS=128
    def __init__(self,path,master):
        self.path=Path(path); self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(self.path.parent,0o700)
        self.aead=AESGCM(HKDF(algorithm=hashes.SHA256(),length=32,salt=b"webgen-runtime-secrets",info=b"v1").derive(master)); self.lock=threading.RLock(); self.data={}; self._failed_closed=False
        self._load()
    @property
    def healthy(self): return not self._failed_closed
    def _ensure_healthy(self):
        if self._failed_closed: raise RuntimeSecretStoreUnavailable("runtime secret store is unavailable; restart after operator review")
    def _load(self):
        if self.path.is_symlink(): raise RuntimeError("invalid runtime secret store")
        if not self.path.exists(): return
        if not self.path.is_file(): raise RuntimeError("invalid runtime secret store")
        stat=self.path.stat()
        if stat.st_uid!=os.geteuid() or stat.st_mode & 0o077: raise RuntimeError("invalid runtime secret store permissions")
        blob=self.path.read_bytes()
        if len(blob)>self.MAX_BYTES or not blob.startswith(self.MAGIC) or len(blob)<len(self.MAGIC)+12+16: raise RuntimeError("invalid runtime secret store")
        try: data=json.loads(self.aead.decrypt(blob[5:17],blob[17:],self.AAD).decode("utf-8"))
        except Exception as e: raise RuntimeError("unable to decrypt runtime secret store") from e
        if not isinstance(data,dict): raise RuntimeError("invalid runtime secret store")
        for project_id,record in data.items():
            try: canonical=str(uuid.UUID(project_id))
            except (ValueError,TypeError,AttributeError): raise RuntimeError("invalid runtime secret project id")
            if canonical!=project_id or not isinstance(record,dict) or not valid_slug(record.get("slug")): raise RuntimeError("invalid runtime secret record")
            for section in ("secrets","pending"):
                entries=record.get(section,{})
                if not isinstance(entries,dict) or len(entries)>self.MAX_SECRETS: raise RuntimeError("invalid runtime secret record")
                for name,value in entries.items():
                    if not isinstance(name,str) or not ENV_KEY_RE.fullmatch(name): raise RuntimeError("invalid runtime secret name")
                    if section=="secrets" and not isinstance(value,str): raise RuntimeError("invalid runtime secret value")
                    if section=="pending" and (not isinstance(value,dict) or not isinstance(value.get("source_name"),str) or not isinstance(value.get("value"),str)): raise RuntimeError("invalid runtime secret migration")
            classifications=record.get("classifications",{})
            secrets_record=record.get("secrets",{})
            if not isinstance(classifications,dict) or set(classifications)-set(secrets_record): raise RuntimeError("invalid runtime secret classification")
            if any(not isinstance(sensitive,bool) for sensitive in classifications.values()): raise RuntimeError("invalid runtime secret classification")
            # Legacy entries were all treated as secrets; keep that safe default.
            record["classifications"]={name:classifications.get(name,True) for name in secrets_record}
            managed=record.get("managed_database")
            if managed is not None:
                if not isinstance(managed,dict) or set(managed)!={"database","runtime_role","migration_role","migration_url"}: raise RuntimeError("invalid managed database record")
                if managed["database"]!=project_database_name(record["slug"]) or managed["runtime_role"]!=runtime_database_role(record["slug"]) or managed["migration_role"]!=migration_database_role(record["slug"]): raise RuntimeError("invalid managed database scope")
                try: migration_url=urlparse(managed["migration_url"])
                except (TypeError,ValueError): raise RuntimeError("invalid migration database URL")
                if migration_url.scheme not in {"postgres","postgresql"} or migration_url.hostname!="postgres" or migration_url.port not in (None,5432) or unquote(migration_url.username or "")!=managed["migration_role"] or unquote(migration_url.path.lstrip("/"))!=managed["database"] or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}",unquote(migration_url.password or "")): raise RuntimeError("invalid migration database URL")
        self.data=data
    def _atomic_write_blob(self,blob):
        tmp=self.path.with_name(self.path.name+".tmp-"+secrets.token_hex(8))
        try:
            fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,"wb") as output: output.write(blob); output.flush(); os.fsync(output.fileno())
            os.replace(tmp,self.path)
        finally: tmp.unlink(missing_ok=True)
    def _fsync_directory(self):
        directory=os.open(self.path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    def _save(self):
        self._ensure_healthy()
        plain=json.dumps(self.data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
        if len(plain)>self.MAX_BYTES-64: raise RuntimeError("runtime secret store is full")
        old_blob=self.path.read_bytes() if self.path.exists() else None
        iv=secrets.token_bytes(12); blob=self.MAGIC+iv+self.aead.encrypt(iv,plain,self.AAD)
        self._atomic_write_blob(blob)
        try: self._fsync_directory()
        except OSError:
            try:
                if old_blob is None: self.path.unlink(missing_ok=True)
                else: self._atomic_write_blob(old_blob)
                self._fsync_directory()
            except Exception as rollback_error:
                self._failed_closed=True
                raise RuntimeSecretStoreUnavailable("runtime secret store persistence rollback failed; service locked") from rollback_error
            raise
    def _change(self,operation):
        self._ensure_healthy()
        snapshot=copy.deepcopy(self.data)
        try:
            result=operation()
            self._save()
            return result
        except BaseException:
            self.data=snapshot
            raise
    def identity_for_slug(self,slug):
        with self.lock:
            self._ensure_healthy()
            matches=[project_id for project_id,record in self.data.items() if record.get("slug")==slug]
            if len(matches)>1: raise WebgenOperationError("project_identity_conflict",409)
            return matches[0] if matches else None
    def bind(self,project_id,slug):
        with self.lock:
            self._ensure_healthy()
            for other_id,record in self.data.items():
                if record.get("slug")==slug and other_id!=project_id: raise WebgenOperationError("project_identity_conflict",409)
            record=self.data.get(project_id)
            if record and record.get("slug")!=slug: raise WebgenOperationError("project_identity_conflict",409)
            if not record:
                self._change(lambda: self.data.__setitem__(project_id,{"slug":slug,"secrets":{},"classifications":{},"pending":{},"managed_database":None}))
    def _record(self,project_id):
        record=self.data.setdefault(project_id,{"slug":None,"secrets":{},"classifications":{},"pending":{},"managed_database":None})
        record.setdefault("classifications",{})
        return record
    def list(self,project_id):
        with self.lock:
            self._ensure_healthy()
            r=self.data.get(project_id,{})
            return {"secrets":[{"name":name,"configured":True,"sensitive":r.get("classifications",{}).get(name,True)} for name in sorted(r.get("secrets",{}))],"pending_migrations":[{"name":name,"source_name":v["source_name"]} for name,v in sorted(r.get("pending",{}).items())]}
    def reveal(self,project_id,name):
        with self.lock:
            self._ensure_healthy()
            record=self.data.get(project_id,{})
            if not valid_slug(record.get("slug")): raise WebgenOperationError("invalid_project_scope",409)
            if name not in record.get("secrets",{}): raise WebgenOperationError("runtime_secret_not_found",404)
            return record["secrets"][name]
    def values(self,project_id):
        with self.lock:
            self._ensure_healthy()
            return dict(self.data.get(project_id,{}).get("secrets",{}))
    def managed_database(self,project_id):
        with self.lock:
            self._ensure_healthy()
            value=self.data.get(project_id,{}).get("managed_database")
            return copy.deepcopy(value) if value is not None else None
    def configure_managed_database(self,project_id,database_url,managed):
        with self.lock:
            self._ensure_healthy()
            r=self._record(project_id)
            if not valid_slug(r.get("slug")) or not isinstance(database_url,str) or not isinstance(managed,dict): raise WebgenOperationError("invalid_project_scope",409)
            if set(managed)!={"database","runtime_role","migration_role","migration_url"} or managed["database"]!=project_database_name(r["slug"]) or managed["runtime_role"]!=runtime_database_role(r["slug"]) or managed["migration_role"]!=migration_database_role(r["slug"]): raise WebgenOperationError("invalid_project_scope",409)
            if "DATABASE_URL" not in r["secrets"] and len(r["secrets"])>=self.MAX_SECRETS: raise WebgenOperationError("too_many_runtime_secrets",422)
            def update():
                r["secrets"]["DATABASE_URL"]=database_url
                r["classifications"]["DATABASE_URL"]=True
                r["managed_database"]=copy.deepcopy(managed)
            self._change(update)
    def put(self,project_id,name,value,sensitive=None):
        with self.lock:
            self._ensure_healthy()
            r=self._record(project_id)
            if not valid_slug(r.get("slug")): raise WebgenOperationError("invalid_project_scope",409)
            if name in r["pending"]: raise WebgenOperationError("migration_pending",409)
            if sensitive is not None and not isinstance(sensitive,bool): raise WebgenOperationError("invalid_classification",400)
            if name not in r["secrets"] and len(r["secrets"])>=self.MAX_SECRETS: raise WebgenOperationError("too_many_runtime_secrets",422)
            exists=name in r["secrets"]
            current_sensitive=r["classifications"].get(name,True)
            next_sensitive=current_sensitive if sensitive is None and exists else (sensitive if sensitive is not None else True)
            if value=="":
                if not exists: raise WebgenOperationError("secret_value_required",422)
                if current_sensitive==next_sensitive: return {"name":name,"configured":True,"unchanged":True,"sensitive":current_sensitive}
                def update_classification():
                    r["classifications"][name]=next_sensitive
                    return {"name":name,"configured":True,"unchanged":False,"sensitive":next_sensitive}
                return self._change(update_classification)
            if exists and r["secrets"][name]==value and current_sensitive==next_sensitive:
                return {"name":name,"configured":True,"unchanged":True,"sensitive":current_sensitive}
            def update():
                r["secrets"][name]=value
                r["classifications"][name]=next_sensitive
                return {"name":name,"configured":True,"unchanged":False,"sensitive":next_sensitive}
            return self._change(update)
    def delete(self,project_id,name):
        with self.lock:
            self._ensure_healthy()
            r=self.data.get(project_id,{"secrets":{},"pending":{}})
            if not valid_slug(r.get("slug")): raise WebgenOperationError("invalid_project_scope",409)
            if name in r.get("pending",{}): raise WebgenOperationError("migration_pending",409)
            if name not in r.get("secrets",{}): raise WebgenOperationError("runtime_secret_not_found",404)
            def remove():
                r.get("classifications",{}).pop(name,None)
                return r["secrets"].pop(name)
            return self._change(remove)
    def stage_migration(self,project_id,name,source_name,value):
        with self.lock:
            self._ensure_healthy()
            r=self._record(project_id)
            if not valid_slug(r.get("slug")): raise WebgenOperationError("invalid_project_scope",409)
            if name not in r["pending"] and len(r["pending"])>=self.MAX_SECRETS: raise WebgenOperationError("too_many_pending_migrations",422)
            if name in r["secrets"]: raise WebgenOperationError("runtime_secret_exists",409)
            existing=r["pending"].get(name)
            if existing and existing.get("source_name")!=source_name: raise WebgenOperationError("migration_pending",409)
            self._change(lambda: r["pending"].__setitem__(name,{"source_name":source_name,"value":value}))
    def commit_migration(self,project_id,name,source_name):
        with self.lock:
            self._ensure_healthy()
            r=self.data.get(project_id,{"secrets":{},"pending":{}}); pending=r.get("pending",{}).get(name)
            if not valid_slug(r.get("slug")): raise WebgenOperationError("invalid_project_scope",409)
            if not pending or pending.get("source_name")!=source_name: raise WebgenOperationError("migration_pending",409)
            if name in r.get("secrets",{}): raise WebgenOperationError("runtime_secret_exists",409)
            def activate():
                r["secrets"][name]=pending["value"]
                r.setdefault("classifications",{})[name]=True
                del r["pending"][name]
            self._change(activate)
    def delete_project(self,project_id):
        self._ensure_healthy()
        if not isinstance(project_id,str): return
        with self.lock:
            if project_id in self.data:
                self._change(lambda: self.data.pop(project_id))
class Service:
    def __init__(self):
        self.workspace=Path(os.getenv("WEBGEN_WORKSPACE_ROOT","/opt/dck-agentic/workspace")).resolve(); self.root=self.workspace/"webgen"; self.nginx=Path(os.getenv("WEBGEN_NGINX_DIR","/etc/nginx/dck-apps")); self.canvas=os.getenv("WEBGEN_CANVAS_AUTH_URL","http://127.0.0.1:8012/api/workspaces"); self.seed=SeedStore(); configured_state=Path(os.getenv("WEBGEN_CONTROL_STATE_DIR","/var/lib/dck-webgen-control"));
        if configured_state.is_symlink(): raise RuntimeError("invalid WebGen state directory")
        self.state=configured_state.resolve()
        if self.state.is_symlink(): raise RuntimeError("invalid WebGen state directory")
        self.state.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(self.state,0o700)
        self.runtime_dir=Path(os.getenv("WEBGEN_RUNTIME_DIR",str(self.state/"runtime")))
        if self.runtime_dir.is_symlink(): raise RuntimeError("invalid WebGen runtime directory")
        self.runtime_dir.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(self.runtime_dir,0o700)
        self.runtime_secrets=RuntimeSecretStore(self.state/"runtime-secrets.enc",self.seed.master); self.migration_lock=threading.Lock(); self.locks={}; self.guard=threading.Lock(); self.build_lock=threading.RLock(); self._validate_canvas(); self._scrub_legacy_workspace_envs()
    def _validate_canvas(self):
        u=urlparse(self.canvas)
        if u.scheme!="http" or u.hostname not in {"127.0.0.1","localhost"} or (u.port or 80)!=8012 or u.path!="/api/workspaces": raise RuntimeError("invalid canvas auth URL")
    def lock_for(self,s):
        with self.guard: return self.locks.setdefault(s,threading.Lock())
    def metadata(self,p):
        try:
            path=p/".dck.json"
            if path.is_symlink(): return {}
            m=json.loads(path.read_text())
            return m if isinstance(m,dict) else {}
        except (OSError,ValueError): return {}
    def _strict_metadata(self,p):
        path=p/".dck.json"
        if path.is_symlink() or not path.is_file(): raise WebgenOperationError("invalid_project_metadata",409)
        try: value=json.loads(path.read_text(encoding="utf-8"))
        except (OSError,UnicodeError,ValueError): raise WebgenOperationError("invalid_project_metadata",409)
        if not isinstance(value,dict): raise WebgenOperationError("invalid_project_metadata",409)
        return value
    def _ensure_project_id(self,slug,p):
        if not safe_project(self.root,slug) or p.resolve()!=safe_project(self.root,slug): raise KeyError
        metadata_path=p/".dck.json"
        meta=self._strict_metadata(p); project_id=meta.get("projectId"); bound_id=self.runtime_secrets.identity_for_slug(slug)
        if project_id is None:
            project_id=bound_id or str(uuid.uuid4()); self.update_meta(p,projectId=project_id)
        else:
            try: canonical=str(uuid.UUID(project_id)) if isinstance(project_id,str) else ""
            except (ValueError,AttributeError): canonical=""
            if not canonical or canonical!=project_id: raise WebgenOperationError("invalid_project_id",409)
            if bound_id and bound_id!=project_id: raise WebgenOperationError("project_identity_conflict",409)
        if self.root.is_dir():
            for other in self.root.iterdir():
                if other.name==slug or not other.is_dir() or other.is_symlink(): continue
                if self.metadata(other).get("projectId")==project_id: raise WebgenOperationError("project_identity_conflict",409)
        self.runtime_secrets.bind(project_id,slug)
        return project_id
    def _safe_env_lines(self,p,base_path,require_manual_review=False):
        lines=[]; example=p/".env.example"; current=p/".env"; runtime_names=set()
        if require_manual_review and valid_slug(p.name) and self._has_manual_review_archive(p.name):
            raise EnvironmentReviewRequired("quarantine")
        if valid_slug(p.name):
            project_id=self.runtime_secrets.identity_for_slug(p.name)
            if project_id:
                runtime_names.update(self.runtime_secrets.values(project_id))
                runtime_names.update(item["name"] for item in self.runtime_secrets.list(project_id)["pending_migrations"])
        seen=set()
        def safe_lines(path,include_comments):
            if path.is_symlink(): raise SecretMaterializationError("invalid environment path")
            if not path.exists(): return []
            try: source=self._local_project_path(p,path.name).read_text(encoding="utf-8").splitlines()
            except (OSError,UnicodeError,ValueError): raise EnvironmentReviewRequired(path.name) from None
            kept=[]
            for line in source:
                match=ENV_LINE_RE.match(line)
                if match:
                    key=match.group(1)
                    if key=="APP_BASE_PATH" or key in runtime_names or self._secret_environment_key(key): continue
                    if path==example and key in seen: continue
                    kept.append(line)
                    seen.add(key)
                elif not line.strip() or line.lstrip().startswith("#"):
                    if include_comments: kept.append(line)
                else:
                    raise EnvironmentReviewRequired(path.name)
            return kept
        lines.extend(safe_lines(current,True))
        lines.extend(safe_lines(example,False))
        lines.append("APP_BASE_PATH="+self._dotenv_quote(base_path))
        return lines
    def _safe_env_file_lines(self,p,path):
        path=Path(path)
        if path.is_symlink(): raise SecretMaterializationError("invalid environment path")
        runtime_names=set(); project_id=self.runtime_secrets.identity_for_slug(p.name)
        if project_id:
            runtime_names.update(self.runtime_secrets.values(project_id))
            runtime_names.update(item["name"] for item in self.runtime_secrets.list(project_id)["pending_migrations"])
        try:
            source_path=self._local_project_path(p,path.relative_to(p).as_posix())
            if source_path.stat().st_size>256*1024: raise EnvironmentReviewRequired(path.name)
            source=source_path.read_text(encoding="utf-8").splitlines()
        except (OSError,UnicodeError,ValueError): raise EnvironmentReviewRequired(path.name) from None
        kept=[]; keys=set()
        for line in source:
            match=ENV_LINE_RE.match(line)
            if match:
                key=match.group(1)
                keys.add(key)
                if key=="APP_BASE_PATH" or key in runtime_names or self._secret_environment_key(key): continue
                kept.append(line)
            elif not line.strip():
                kept.append(line)
            elif line.lstrip().startswith("#"):
                comment=ENV_LINE_RE.match(line.lstrip()[1:].lstrip())
                if comment and (comment.group(1) in runtime_names or self._secret_environment_key(comment.group(1))): continue
                kept.append(line)
            else:
                raise EnvironmentReviewRequired(path.name)
        return kept,keys
    def _secure_private_directory(self,path):
        path=Path(path)
        if path.is_symlink(): raise OSError("private directory is a symlink")
        path.mkdir(parents=True,exist_ok=True,mode=0o700)
        uid=os.geteuid(); gid=os.getegid()
        os.chown(path,uid,gid); os.chmod(path,0o700)
        info=path.stat()
        resolved=path.resolve(); workspace=self.root.resolve()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=uid or info.st_gid!=gid or stat.S_IMODE(info.st_mode)!=0o700:
            raise OSError("private directory permissions are invalid")
        if resolved==workspace or workspace in resolved.parents:
            raise OSError("private directory is inside the agent workspace")
        return resolved
    @staticmethod
    def _sync_directory(path):
        fd=os.open(path,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
        try: os.fsync(fd)
        finally: os.close(fd)
    @staticmethod
    def _secure_quarantine_file(path):
        fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
        try:
            os.fchown(fd,os.geteuid(),os.getegid()); os.fchmod(fd,0o600); os.fsync(fd)
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_gid!=os.getegid() or stat.S_IMODE(info.st_mode)!=0o600:
                raise OSError("quarantine file permissions are invalid")
        finally: os.close(fd)
    def _copy_env_to_private(self,source,destination):
        source_fd=os.open(source,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0)); destination_fd=None; removed=False
        try:
            before=os.fstat(source_fd)
            if not stat.S_ISREG(before.st_mode): raise OSError("environment source is not a regular file")
            destination_fd=os.open(destination,os.O_CREAT|os.O_EXCL|os.O_WRONLY|getattr(os,"O_NOFOLLOW",0),0o600)
            os.fchown(destination_fd,os.geteuid(),os.getegid())
            while True:
                chunk=os.read(source_fd,65536)
                if not chunk: break
                view=memoryview(chunk)
                while view:
                    written=os.write(destination_fd,view)
                    if written<=0: raise OSError("quarantine copy failed")
                    view=view[written:]
            after=os.fstat(source_fd)
            if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
                raise OSError("environment source changed during quarantine")
            os.fchmod(destination_fd,0o600); os.fsync(destination_fd)
            path_info=Path(source).lstat()
            if not stat.S_ISREG(path_info.st_mode) or (path_info.st_dev,path_info.st_ino)!=(before.st_dev,before.st_ino):
                raise OSError("environment source changed during quarantine")
            os.unlink(source); removed=True
            try: self._sync_directory(Path(source).parent)
            except OSError as error: raise QuarantineDurabilityError("workspace environment removal durability is uncertain") from error
        except Exception:
            if not removed and Path(destination).exists(): Path(destination).unlink(missing_ok=True)
            raise
        finally:
            if destination_fd is not None: os.close(destination_fd)
            os.close(source_fd)
    def _move_env_to_private(self,source,destination):
        source=Path(source); destination=Path(destination)
        if source.is_symlink() or not source.is_file() or destination.exists() or destination.is_symlink():
            raise OSError("invalid quarantine source or destination")
        try: os.replace(source,destination)
        except OSError as error:
            if error.errno!=errno.EXDEV: raise
            self._copy_env_to_private(source,destination)
        self._secure_quarantine_file(destination)
        self._sync_directory(source.parent)
        self._sync_directory(destination.parent)
    def _quarantine_legacy_env(self,p,target):
        archive_name=f"manual-review-{p.name}-{int(time.time())}-{secrets.token_hex(8)}.env"
        destinations=[]
        for directory in (self.state/"legacy-env-quarantine",self.state):
            try: private=self._secure_private_directory(directory)
            except OSError: continue
            destinations.append(private/archive_name)
        for destination in destinations:
            try:
                self._move_env_to_private(target,destination)
            except QuarantineDurabilityError:
                try:
                    if target.exists() or target.is_symlink(): target.unlink()
                    self._sync_directory(target.parent)
                except OSError: pass
                logger.error("WebGen startup blocked: removal durability for ambiguous .env in project %s is uncertain.",p.name)
                raise RuntimeError("legacy environment removal durability uncertain; service startup blocked") from None
            except Exception:
                if not target.exists():
                    if destination.exists():
                        try:
                            self._secure_quarantine_file(destination)
                            self._sync_directory(destination.parent)
                        except Exception:
                            raise RuntimeError("legacy environment quarantine permissions could not be verified; service startup blocked") from None
                        logger.warning("Quarantined ambiguous legacy .env for project %s at protected path %s; operator review is required before lifecycle actions.",p.name,destination)
                        return destination
                    raise RuntimeError("legacy environment quarantine state could not be verified; service startup blocked") from None
                continue
            logger.warning("Quarantined ambiguous legacy .env for project %s at protected path %s; operator review is required before lifecycle actions.",p.name,destination)
            return destination
        try:
            if target.exists() and not target.is_symlink() and target.is_file():
                target.unlink(); self._sync_directory(target.parent)
        except OSError:
            logger.error("WebGen startup blocked: ambiguous .env for project %s could not be quarantined or removed from the agent workspace.",p.name)
            raise RuntimeError("legacy environment file remains exposed; service startup blocked") from None
        if target.exists() or target.is_symlink():
            logger.error("WebGen startup blocked: ambiguous .env for project %s could not be removed from the agent workspace.",p.name)
            raise RuntimeError("legacy environment file remains exposed; service startup blocked")
        logger.error("WebGen startup blocked: ambiguous .env for project %s was removed from the workspace but no secure archive could be created; restore from backup before service recovery.",p.name)
        raise RuntimeError("legacy environment quarantine failed; workspace copy removed and service startup blocked")
    def _has_manual_review_archive(self,slug):
        pattern=f"manual-review-{slug}-*.env"
        for directory in (self.state/"legacy-env-quarantine",self.state):
            try: candidates=directory.glob(pattern)
            except OSError: continue
            for candidate in candidates:
                try:
                    info=candidate.lstat()
                    if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode): return True
                except OSError: continue
        return False
    def _scrub_legacy_workspace_envs(self):
        """Scrub safe legacy values and quarantine ambiguous files outside agent access."""
        if not self.root.is_dir(): return
        for p in self.root.iterdir():
            if not p.is_dir() or p.is_symlink() or not valid_slug(p.name) or not safe_project(self.root,p.name): continue
            targets=[p/".env"]
            try: _,_,_,env_files=self._source_compose(p)
            except (OSError,ValueError): env_files=[]
            targets.extend(path for path in env_files if path!=(p/".env").resolve())
            base="" if self._published_label(self.metadata(p)) else f"/preview/{p.name}"
            for target in dict.fromkeys(targets):
                if not target.exists() or target.is_symlink() or not target.is_file(): continue
                try:
                    if target==(p/".env"):
                        self._write_project_env(p,self._safe_env_lines(p,base))
                    else:
                        lines,_=self._safe_env_file_lines(p,target)
                        self._write_project_env(p,lines,target)
                except EnvironmentReviewRequired:
                    self._quarantine_legacy_env(p,target)
                except (WebgenOperationError,SecretMaterializationError): continue
    def port(self,m):
        v=m.get("port")
        if isinstance(v,bool) or not isinstance(v,int) or not 3000<=v<=65535: raise ValueError("invalid port")
        return v
    @staticmethod
    def group_containers(lines):
        groups={}
        for d in lines:
            proj=d.get("project")
            if proj: groups.setdefault(proj,[]).append({k:d.get(k) for k in ("id","name","state","health","exit_code")})
        return groups
    def all_container_status(self):
        try: cp=subprocess.run(["docker","ps","-a","--filter","label=com.docker.compose.project","--format","{{json .}}"],capture_output=True,text=True,timeout=3,check=False)
        except (OSError,subprocess.TimeoutExpired): return None
        if cp.returncode: return None
        raw=[]
        for line in cp.stdout.splitlines()[:512]:
            try:d=json.loads(line)
            except ValueError:continue
            labels=d.get("Labels",""); mm=re.search(r"com\.docker\.compose\.project=([A-Za-z0-9_.-]+)",labels) if isinstance(labels,str) else None; cid=str(d.get("ID","")); status=str(d.get("Status","")); hm=re.search(r"\((healthy|unhealthy|starting)\)",status)
            raw.append({"project":mm.group(1) if mm else None,"id":cid,"name":str(d.get("Names","")),"state":str(d.get("State","")),"health":hm.group(1) if hm else None,"exit_code":None})
        ids=[x["id"] for x in raw if re.fullmatch(r"[A-Fa-f0-9]{12,64}",x["id"])]
        if ids:
            try:
                # @spec WR-019 — Health is absent on containers without a healthcheck.
                ir=subprocess.run(["docker","inspect","--format","{{.Id}}|{{json .State}}"]+ids,capture_output=True,text=True,timeout=3,check=False)
                if ir.returncode: return None
                info={}
                for line in ir.stdout.splitlines():
                    cid,separator,state=line.partition("|")
                    if not separator: return None
                    try: state=json.loads(state)
                    except ValueError: return None
                    if not isinstance(state,dict): return None
                    info[cid]=state
                for d in raw:
                    x=next((v for k,v in info.items() if k.startswith(d["id"])),None)
                    if x is not None:
                        d["exit_code"]=x.get("ExitCode")
                        health=x.get("Health")
                        d["health"]=health.get("Status") if isinstance(health,dict) else None
            except (OSError,subprocess.TimeoutExpired): return None
        return self.group_containers(raw)
    def project(self,slug,p,status_groups=None):
        m=self.metadata(p); unknown=status_groups is None; cs=[{k:x.get(k) for k in ("id","name","state","health","exit_code")} for x in (status_groups or {}).get(slug,[])]; states=[str(x.get("state") or "").lower() for x in cs]
        if unknown: status="unknown"
        elif any(x.get("health")=="unhealthy" or (x.get("exit_code") not in (None,0) and str(x.get("state") or "").lower()=="exited") for x in cs): status="error"
        elif any(state in {"restarting","created"} for state in states) or any(x.get("health")=="starting" for x in cs): status="starting"
        elif "running" in states: status="running"
        elif cs: status="stopped"
        else: status="error" if m.get("lastStatus")=="error" else "stopped"
        checked=now_iso() if not unknown else m.get("lastCheckedAt")
        try: port=self.port(m)
        except ValueError: port=None
        name=m.get("name"); name=name[:100] if isinstance(name,str) and name.strip() else slug
        stack=m.get("stack"); stack=stack[:64] if isinstance(stack,str) else None
        auth=m.get("authProvider"); auth=auth.lower()[:64] if isinstance(auth,str) else None
        expected_preview=f"/preview/{slug}"; preview=expected_preview if m.get("previewPath")==expected_preview else None
        domain=m.get("subdomain"); subdomain=None
        if isinstance(domain,str) and domain.endswith(".dckautoposting.com") and valid_subdomain(domain[:-len(".dckautoposting.com")]): subdomain=domain
        if subdomain: preview=None
        has_deployment=bool(subdomain or preview)
        return {"slug":slug,"path":f"/projects/webgen/{slug}","name":name,"port":port,"stack":stack,"auth_provider":auth,"preview_path":preview,"subdomain":subdomain,"has_deployment":has_deployment,"status":status,"last_checked_at":checked,"containers":cs}
    def projects(self):
        groups=self.all_container_status(); out=[]
        if not self.root.is_dir(): return out
        for p in self.root.iterdir():
            if p.is_dir() and not p.is_symlink() and valid_slug(p.name) and safe_project(self.root,p.name) and (p/".dck.json").is_file(): out.append(self.project(p.name,p,groups))
        return out
    def _local_project_path(self,p,value,kind="file",optional=False):
        if not isinstance(value,str) or not value or Path(value).is_absolute() or ".." in Path(value).parts or "\\" in value or "://" in value: raise ValueError("unsafe project path")
        candidate=p/value
        if candidate.is_symlink(): raise ValueError("unsafe project symlink")
        if optional and not candidate.exists(): return None
        try: resolved=candidate.resolve(strict=not optional)
        except OSError:
            if optional and not candidate.exists(): return None
            raise ValueError("invalid project path")
        root=p.resolve()
        if resolved!=root and root not in resolved.parents: raise ValueError("unsafe project path")
        if kind=="file" and not resolved.is_file(): raise ValueError("invalid project file")
        if kind=="directory" and not resolved.is_dir(): raise ValueError("invalid project directory")
        return resolved
    def _source_compose(self,p,source_bytes=None):
        cf=p/"docker-compose.yml"
        env_path=p/".env"
        if not cf.is_file() or cf.is_symlink() or cf.stat().st_size>1024*1024 or cf.resolve().parent!=p.resolve() or env_path.is_symlink() or (env_path.exists() and not env_path.is_file()): raise ValueError("invalid compose")
        if source_bytes is None:
            try: source_bytes=cf.read_bytes()
            except OSError: raise ValueError("invalid compose")
        try: raw=yaml.safe_load(source_bytes.decode("utf-8"))
        except (UnicodeError,yaml.YAMLError): raise ValueError("invalid compose")
        if not isinstance(raw,dict) or any(k in raw for k in ("volumes","configs","secrets","include")): raise ValueError("unsafe compose resources")
        services=raw.get("services")
        if not isinstance(services,dict) or set(services)!={"app"} or not isinstance(services["app"],dict): raise ValueError("unsafe compose topology")
        app=services["app"]
        banned=("volumes","volumes_from","configs","secrets","devices","cap_add","privileged","network_mode","pid","ipc","uts","extends")
        if any(app.get(k) for k in banned): raise ValueError("unsafe compose policy")
        env_files=app.get("env_file",[])
        if isinstance(env_files,(str,dict)): env_files=[env_files]
        if not isinstance(env_files,list): raise ValueError("unsafe env_file")
        resolved_env_files=[]
        for entry in env_files:
            required=True
            if isinstance(entry,dict):
                path=entry.get("path"); required=entry.get("required",True)
            else: path=entry
            if not isinstance(required,bool): raise ValueError("unsafe env_file")
            if path==".env.example": raise ValueError(".env.example cannot be a runtime env_file")
            resolved=self._local_project_path(p,path,optional=(not required or path==".env"))
            if resolved is not None: resolved_env_files.append(resolved)
        build=app.get("build")
        if build:
            build=build if isinstance(build,dict) else {"context":build}
            if not isinstance(build,dict): raise ValueError("unsafe build")
            context=self._local_project_path(p,build.get("context","."),kind="directory")
            dockerfile=build.get("dockerfile","Dockerfile")
            if not isinstance(dockerfile,str): raise ValueError("unsafe build")
            relative_context=str(context.relative_to(p.resolve())) or "."
            dockerfile_path=(Path(relative_context)/dockerfile).as_posix()
            self._local_project_path(p,dockerfile_path)
        return cf,raw,app,resolved_env_files
    @staticmethod
    def _env_keys_from_file(path):
        keys=set()
        if path.stat().st_size>256*1024: raise ValueError("environment file too large")
        try: lines=path.read_text(encoding="utf-8").splitlines()
        except (OSError,UnicodeError): raise ValueError("invalid environment file")
        for line in lines:
            match=ENV_LINE_RE.match(line)
            if match: keys.add(match.group(1))
        return keys
    def project_env_keys(self,p,raw,app,env_files):
        keys=set(); environment=app.get("environment",{})
        if isinstance(environment,dict): keys.update(k for k in environment if isinstance(k,str) and ENV_KEY_RE.fullmatch(k))
        elif isinstance(environment,list):
            for item in environment:
                if isinstance(item,str):
                    key=item.split("=",1)[0]
                    if ENV_KEY_RE.fullmatch(key): keys.add(key)
        elif environment: raise ValueError("invalid environment")
        for path in env_files: keys.update(self._env_keys_from_file(path))
        example=p/".env.example"
        if example.exists(): keys.update(self._env_keys_from_file(self._local_project_path(p,".env.example")))
        def scan(value):
            if isinstance(value,dict):
                for key,item in value.items(): scan(key); scan(item)
            elif isinstance(value,list):
                for item in value: scan(item)
            elif isinstance(value,str):
                keys.update(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)",value))
                keys.update(re.findall(r"(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)",value))
        scan(raw)
        return keys
    @staticmethod
    def docker_environment():
        env={"PATH":os.getenv("PATH","/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),"HOME":"/root","COMPOSE_PARALLEL_LIMIT":"1"}
        if config:=os.getenv("WEBGEN_DOCKER_CONFIG"): env["DOCKER_CONFIG"]=config
        return env
    def compose_config(self,slug,p,compose_file=None,source_bytes=None):
        cf,source,app,env_files=self._source_compose(p,source_bytes); compose_file=compose_file or cf; m=self.metadata(p); port=self.port(m)
        clean_env=self.docker_environment()
        try:r=subprocess.run(["docker","compose","-f",str(compose_file),"-p",slug,"--project-directory",str(p),"config","--no-env-resolution","--format","json"],cwd=str(p),capture_output=True,text=True,timeout=30,check=False,env=clean_env)
        except (OSError,subprocess.TimeoutExpired): raise RuntimeError("compose validation failed")
        if r.returncode: raise RuntimeError("compose validation failed")
        try:cfg=json.loads(r.stdout)
        except ValueError: raise ValueError("invalid compose")
        nets=cfg.get("networks"); services=cfg.get("services")
        if any(cfg.get(k) for k in ("volumes","configs","secrets")): raise ValueError("unsafe compose resources")
        if not isinstance(nets,dict) or set(nets)!={"dck"} or not isinstance(nets["dck"],dict) or nets["dck"].get("external") is not True or nets["dck"].get("name")!="dck": raise ValueError("unsafe compose network")
        if not isinstance(services,dict) or set(services)!={"app"}: raise ValueError("unsafe compose topology")
        s=services["app"]; banned=("volumes","volumes_from","configs","secrets","devices","cap_add","privileged","network_mode","pid","ipc","uts")
        if not isinstance(s,dict) or s.get("container_name")!=slug+"-app" or any(s.get(k) for k in banned): raise ValueError("unsafe compose policy")
        sn=s.get("networks"); names=set(sn) if isinstance(sn,dict) else set(sn or [])
        if names!={"dck"}: raise ValueError("unsafe compose network")
        ports=s.get("ports") or []
        if not isinstance(ports,list) or len(ports)!=1: raise ValueError("unsafe compose ports")
        for x in ports:
            if not isinstance(x,dict): raise ValueError("unsafe compose ports")
            try: target=int(x.get("target")); pub=int(x.get("published")); host=x.get("host_ip","127.0.0.1")
            except (TypeError,ValueError): raise ValueError("unsafe compose ports")
            if target!=3000 or pub!=port or host!="127.0.0.1": raise ValueError("unsafe compose ports")
        return cfg
    def compose(self,slug,p,action,runtime_env_file=None):
        clean_env=self.docker_environment()
        source=p/"docker-compose.yml"
        if not source.is_file() or source.is_symlink() or source.stat().st_size>1024*1024: raise ValueError("invalid compose")
        source_bytes=source.read_bytes()
        with self.build_lock:
            with tempfile.TemporaryDirectory(prefix="webgen-compose-") as temporary:
                snapshot=Path(temporary)/"docker-compose.yml"; snapshot.write_bytes(source_bytes); os.chmod(snapshot,0o400)
                self.compose_config(slug,p,compose_file=snapshot,source_bytes=source_bytes)
                overlay=None
                if runtime_env_file is not None:
                    env_path=Path(runtime_env_file)
                    try: resolved=env_path.resolve(strict=True)
                    except OSError: raise SecretMaterializationError("invalid runtime environment")
                    runtime_root=Path(getattr(self,"runtime_dir",self.state/"runtime")).resolve()
                    if env_path.is_symlink() or not env_path.is_file() or runtime_root not in resolved.parents or env_path.stat().st_mode & 0o077: raise SecretMaterializationError("invalid runtime environment")
                    overlay=Path(temporary)/"runtime-overlay.yml"
                    overlay.write_text("services:\n  app:\n    env_file:\n      - "+json.dumps(str(resolved))+"\n",encoding="utf-8")
                    os.chmod(overlay,0o400)
                base=["docker","compose","-p",slug,"-f",str(snapshot)]
                if overlay is not None: base.extend(["-f",str(overlay)])
                base.extend(["--project-directory",str(p)])
                commands=[]
                if action in {"rebuild","restart"}: commands.append(base+["down","--remove-orphans"])
                command=command_for(slug,action,snapshot,p)
                if overlay is not None: command[command.index("--project-directory"):command.index("--project-directory")]=["-f",str(overlay)]
                commands.append(command)
                for command in commands:
                    result=subprocess.run(command,cwd=str(p),capture_output=True,text=True,timeout=900,check=False,env=clean_env)
                    if result.returncode: return result
                return result
    @staticmethod
    def _secret_environment_key(name):
        upper=name.upper()
        parts=upper.split("_")
        return upper in {"DATABASE_URL","REDIS_URL","BETTER_AUTH_SECRET","TOKEN","SECRET","PASSWORD","CREDENTIALS"} or any(part in {"SECRET","PASSWORD","TOKEN","CREDENTIAL","CREDENTIALS"} for part in parts) or any("_".join(parts[index:index+2]) in {"API_KEY","PRIVATE_KEY","ACCESS_KEY"} for index in range(len(parts)-1))
    @staticmethod
    def _dotenv_quote(value):
        if any(ord(ch)<32 or ord(ch)==127 for ch in value): raise SecretMaterializationError("invalid secret value")
        return json.dumps(value.replace("$","$$"),ensure_ascii=False)
    def _secret_request(self,api_key,path,max_bytes):
        if not isinstance(api_key,str) or not api_key: raise SecretMaterializationError("authentication unavailable")
        base=self.canvas.removesuffix("/api/workspaces")
        try:
            with urlopen(Request(base+path,headers={"X-Session-API-Key":api_key}),timeout=5) as response:
                data=response.read(max_bytes+1)
        except HTTPError as e:
            if e.code==404: raise WebgenOperationError("agent_secret_not_found",404)
            raise SecretMaterializationError("secret manager unavailable",503,"secret_manager_unavailable")
        except Exception: raise SecretMaterializationError("secret manager unavailable",503,"secret_manager_unavailable")
        if len(data)>max_bytes: raise SecretMaterializationError("secret response too large",502,"invalid_secret_response")
        return data
    def _agent_secret_names(self,api_key):
        raw=self._secret_request(api_key,"/api/settings/secrets",1024*1024)
        try: items=json.loads(raw.decode("utf-8")).get("secrets",[])
        except (UnicodeError,ValueError,AttributeError): raise SecretMaterializationError("invalid secret list",502,"invalid_secret_response")
        if not isinstance(items,list): raise SecretMaterializationError("invalid secret list",502,"invalid_secret_response")
        names={item.get("name") for item in items if isinstance(item,dict) and isinstance(item.get("name"),str) and SECRET_NAME_RE.fullmatch(item["name"])}
        return sorted(names)
    @staticmethod
    def _valid_runtime_secret_name(name):
        return isinstance(name,str) and bool(ENV_KEY_RE.fullmatch(name)) and name!="APP_BASE_PATH" and not name.startswith("WEBGEN_") and name not in {"PATH","HOME","COMPOSE_PARALLEL_LIMIT"}
    @staticmethod
    def _valid_runtime_secret_value(value):
        return isinstance(value,str) and len(value.encode("utf-8"))<=8192 and not any(ord(ch)<32 or ord(ch)==127 for ch in value)
    # @spec WR-020 — Generate required app credentials only for explicit lifecycle operations.
    @staticmethod
    def _database_name(slug): return project_database_name(slug)
    @staticmethod
    def _runtime_database_role(slug): return runtime_database_role(slug)
    @staticmethod
    def _migration_database_role(slug): return migration_database_role(slug)
    @staticmethod
    def _pg_identifier(value): return '"'+value.replace('"','""')+'"'
    @staticmethod
    def _pg_literal(value): return "'"+value.replace("'","''")+"'"
    def _matches_generated_database_url(self,value,slug):
        try:
            parsed=urlparse(value)
            return parsed.scheme in {"postgres","postgresql"} and parsed.hostname=="postgres" and parsed.port in (None,5432) and unquote(parsed.username or "")==self._runtime_database_role(slug) and unquote(parsed.path.lstrip("/"))==self._database_name(slug)
        except (TypeError,ValueError): return False
    def _matches_project_database_url(self,value,slug):
        return self._matches_generated_database_url(value,slug)
    def ensure_generated_runtime_secrets(self,slug,p):
        project_id=self._ensure_project_id(slug,p); metadata=self._strict_metadata(p); auth=metadata.get("authProvider")
        needs_database=metadata.get("needsDatabase") is True or auth=="better-auth"
        values=self.runtime_secrets.values(project_id); database_url=values.get("DATABASE_URL"); managed=self.runtime_secrets.managed_database(project_id)
        managed_database=False
        if needs_database and database_url is None:
            runtime_role=self._runtime_database_role(slug); migration_role=self._migration_database_role(slug); database=self._database_name(slug)
            runtime_password=secrets.token_urlsafe(48)
            database_url=f"postgresql://{quote(runtime_role,safe='')}:{quote(runtime_password,safe='')}@postgres:5432/{quote(database,safe='')}"
            if managed is None:
                migration_password=secrets.token_urlsafe(48)
                migration_url=f"postgresql://{quote(migration_role,safe='')}:{quote(migration_password,safe='')}@postgres:5432/{quote(database,safe='')}"
                managed={"database":database,"runtime_role":runtime_role,"migration_role":migration_role,"migration_url":migration_url}
            self.runtime_secrets.configure_managed_database(project_id,database_url,managed)
            values["DATABASE_URL"]=database_url; managed_database=True
        elif needs_database and self._matches_generated_database_url(database_url,slug):
            if not managed:
                # A database created by an older control-service version has no
                # encrypted migration identity. Do not guess, adopt or alter it.
                raise WebgenOperationError("database_migration_setup_required",503)
            if managed.get("database")!=self._database_name(slug) or managed.get("runtime_role")!=self._runtime_database_role(slug) or managed.get("migration_role")!=self._migration_database_role(slug):
                raise WebgenOperationError("database_provisioning_failed",503)
            managed_database=True
        if auth=="better-auth" and "BETTER_AUTH_SECRET" not in values:
            self.runtime_secrets.put(project_id,"BETTER_AUTH_SECRET",secrets.token_urlsafe(48))
        if managed_database:
            runtime_parsed=urlparse(database_url); migration_parsed=urlparse(managed["migration_url"])
            runtime_password=unquote(runtime_parsed.password or ""); migration_password=unquote(migration_parsed.password or "")
            self._provision_project_database(slug,self._database_name(slug),self._runtime_database_role(slug),runtime_password,self._migration_database_role(slug),migration_password)
    def _run_postgres_script(self,sql,database="postgres",timeout=30,tuples_only=False):
        user=os.getenv("WEBGEN_POSTGRES_USER","dck")
        container=os.getenv("WEBGEN_POSTGRES_CONTAINER","dck-postgres")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*",user) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}",container) or not re.fullmatch(r"[A-Za-z0-9_-]{1,63}",database):
            raise WebgenOperationError("database_provisioning_failed",503)
        command=["docker","exec","-i",container,"psql","-X","-q","-U",user,"-d",database,"-v","ON_ERROR_STOP=1"]
        if tuples_only: command.extend(["-t","-A"])
        try:
            result=subprocess.run(command,input=sql,capture_output=True,text=True,timeout=timeout,check=False,env=self.docker_environment())
        except (OSError,subprocess.TimeoutExpired): raise WebgenOperationError("database_provisioning_failed",503) from None
        if result.returncode: raise WebgenOperationError("database_provisioning_failed",503)
        return result
    def _provision_project_database(self,slug,database,role,password,migration_role,migration_password):
        owner=os.getenv("WEBGEN_POSTGRES_USER","dck")
        if not valid_slug(slug) or database!=self._database_name(slug) or role!=self._runtime_database_role(slug) or migration_role!=self._migration_database_role(slug) or role==migration_role or role==owner or migration_role==owner or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*",owner) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}",password) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}",migration_password):
            raise WebgenOperationError("database_provisioning_failed",503)
        db_ident=self._pg_identifier(database); role_ident=self._pg_identifier(role); migration_ident=self._pg_identifier(migration_role)
        db_literal=self._pg_literal(database); role_literal=self._pg_literal(role); migration_literal=self._pg_literal(migration_role)
        exists=self._run_postgres_script(f"SELECT 1 FROM pg_database WHERE datname={db_literal};",tuples_only=True).stdout.strip()
        if exists:
            actual_owner=self._run_postgres_script(f"SELECT r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname={db_literal};",tuples_only=True).stdout.strip()
            if actual_owner!=migration_role:
                raise WebgenOperationError("database_provisioning_failed",503)
        def ensure_role(name,identifier,literal,secret,allow_database_owner):
            role_exists=self._run_postgres_script(f"SELECT 1 FROM pg_roles WHERE rolname={literal};",tuples_only=True).stdout.strip()
            if role_exists:
                owner_clause=(f"AND NOT ((s.dbid=0 AND s.classid='pg_database'::regclass AND s.objid=(SELECT oid FROM pg_database WHERE datname={db_literal})) OR s.dbid=(SELECT oid FROM pg_database WHERE datname={db_literal}))" if allow_database_owner else "")
                owned_check=(f"OR EXISTS (SELECT 1 FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o' {owner_clause})")
                unsafe=self._run_postgres_script(
                    f"SELECT 1 FROM pg_roles r WHERE r.rolname={literal} AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) OR EXISTS (SELECT 1 FROM pg_tablespace t WHERE t.spcowner=r.oid) {owned_check});",
                    tuples_only=True,
                ).stdout.strip()
                if unsafe: raise WebgenOperationError("database_provisioning_failed",503)
                statement=f"ALTER ROLE {identifier} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {self._pg_literal(secret)};"
            else:
                statement=f"CREATE ROLE {identifier} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {self._pg_literal(secret)};"
            self._run_postgres_script(statement)
        ensure_role(migration_role,migration_ident,migration_literal,migration_password,True)
        ensure_role(role,role_ident,role_literal,password,False)
        if not exists:
            self._run_postgres_script(f"CREATE DATABASE {db_ident} OWNER {migration_ident};")
        actual_owner=self._run_postgres_script(f"SELECT r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname={db_literal};",tuples_only=True).stdout.strip()
        if actual_owner!=migration_role: raise WebgenOperationError("database_provisioning_failed",503)
        self._synchronize_runtime_database_access(slug,database,role,migration_role)
    def _synchronize_runtime_database_access(self,slug,database,role,migration_role):
        if database!=self._database_name(slug) or role!=self._runtime_database_role(slug) or migration_role!=self._migration_database_role(slug):
            raise WebgenOperationError("database_provisioning_failed",503)
        db_ident=self._pg_identifier(database); role_ident=self._pg_identifier(role); migration_ident=self._pg_identifier(migration_role)
        role_literal=self._pg_literal(role); migration_literal=self._pg_literal(migration_role)
        grant_sql=f"""REVOKE ALL PRIVILEGES ON DATABASE {db_ident} FROM PUBLIC;
GRANT CONNECT ON DATABASE {db_ident} TO {role_ident};
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM {role_ident};
GRANT USAGE ON SCHEMA public TO {role_ident};
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM {role_ident};
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM {role_ident};
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM {role_ident};
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role_ident};
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role_ident};
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE {migration_ident} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM {role_ident};
DO $webgen$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND lower(c.relname) NOT LIKE '%migration%'
      AND lower(c.relname) NOT IN ('typeorm_metadata','alembic_version','flyway_schema_history','schema_version','schema_versions')
  LOOP
    IF item.relkind IN ('v','m','f') THEN
      EXECUTE format('GRANT SELECT ON TABLE %I.%I TO %I','public',item.relname,{role_literal});
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I','public',item.relname,{role_literal});
    END IF;
  END LOOP;
  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND (lower(c.relname) LIKE '%migration%'
        OR lower(c.relname) IN ('typeorm_metadata','alembic_version','flyway_schema_history','schema_version','schema_versions'))
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC','public',item.relname);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I','public',item.relname,{role_literal});
  END LOOP;
  FOR item IN
    SELECT DISTINCT sn.nspname AS schema_name, s.relname AS sequence_name
    FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_class'::regclass
    JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=t.relnamespace
    WHERE s.relkind='S' AND tn.nspname='public' AND t.relkind IN ('r','p')
      AND lower(t.relname) NOT LIKE '%migration%'
      AND lower(t.relname) NOT IN ('typeorm_metadata','alembic_version','flyway_schema_history','schema_version','schema_versions')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO %I',item.schema_name,item.sequence_name,{role_literal});
  END LOOP;
END
$webgen$;
ALTER SCHEMA public OWNER TO {migration_ident};"""
        self._run_postgres_script(grant_sql,database=database)
    def run_project_migrations(self,slug,p):
        metadata=self._strict_metadata(p)
        if metadata.get("needsDatabase") is not True and metadata.get("authProvider")!="better-auth": return
        project_id=self._ensure_project_id(slug,p); managed=self.runtime_secrets.managed_database(project_id)
        if not managed: return
        runtime_url=self.runtime_secrets.values(project_id).get("DATABASE_URL")
        if not self._matches_generated_database_url(runtime_url,slug): raise WebgenOperationError("database_migration_setup_required",503)
        try:
            migrations=collect_project_migrations(p)
            if not migrations: return
            migration_url=urlparse(managed["migration_url"])
            password=unquote(migration_url.password or "")
            runner=MigrationRunner(self.runtime_dir,self.docker_environment())
            runner.apply(slug,managed["database"],managed["migration_role"],password,migrations)
            self._synchronize_runtime_database_access(slug,managed["database"],managed["runtime_role"],managed["migration_role"])
        except MigrationError:
            raise WebgenOperationError("database_migration_failed",503) from None
    def runtime_secret_payload(self,slug,p,api_key):
        project_id=self._ensure_project_id(slug,p); payload=self.runtime_secrets.list(project_id)
        try: candidates=self._legacy_secret_candidates(slug,api_key)
        except (SecretMaterializationError,WebgenOperationError): candidates=[]; payload["migration_available"]=False
        else: payload["migration_available"]=True
        known={item["source_name"] for item in candidates}
        pending_by_source={item["source_name"]:item for item in payload["pending_migrations"]}
        for candidate in candidates:
            if candidate["source_name"] in pending_by_source:
                candidate["pending"]=True
                candidate["ambiguous"]=False
        for pending in payload["pending_migrations"]:
            if pending["source_name"] not in known: candidates.append({"source_name":pending["source_name"],"runtime_name":pending["name"],"ambiguous":False,"pending":True})
        payload.update({"project_id":project_id,"migration_candidates":candidates})
        return payload
    def _legacy_secret_candidates(self,slug,api_key):
        suffix="_"+slug.upper().replace("-","_"); names=self._agent_secret_names(api_key); slugs=[]
        if self.root.is_dir(): slugs=[p.name for p in self.root.iterdir() if p.is_dir() and not p.is_symlink() and valid_slug(p.name) and safe_project(self.root,p.name)]
        candidates=[]
        for name in names:
            if not name.endswith(suffix): continue
            runtime_name=name[:-len(suffix)]
            if not self._valid_runtime_secret_name(runtime_name): continue
            matches=[other for other in slugs if name.endswith("_"+other.upper().replace("-","_"))]
            if slug in matches: candidates.append({"source_name":name,"runtime_name":runtime_name,"ambiguous":len(matches)>1})
        return candidates
    def migrate_runtime_secret(self,slug,p,api_key,source_name,confirm_ambiguous=False):
        with self.migration_lock:
            project_id=self._ensure_project_id(slug,p)
            if not isinstance(source_name,str) or not SECRET_NAME_RE.fullmatch(source_name): raise ValueError("invalid source secret")
            store_list=self.runtime_secrets.list(project_id); pending=next((x for x in store_list["pending_migrations"] if x["source_name"]==source_name),None)
            if pending:
                name=pending["name"]
                try: raw=self._secret_request(api_key,"/api/settings/secrets/"+quote(source_name,safe=""),65536)
                except WebgenOperationError as error:
                    if error.code!="agent_secret_not_found": raise
                    self.runtime_secrets.commit_migration(project_id,name,source_name)
                    return {"name":name,"configured":True,"source_removed":True,"pending":False}
                except SecretMaterializationError as error:
                    raise SecretMaterializationError("migration source could not be verified",503,"migration_pending") from error
                else:
                    try: value=raw.decode("utf-8")
                    except UnicodeError: raise SecretMaterializationError("invalid secret encoding")
                    if not self._valid_runtime_secret_value(value): raise SecretMaterializationError("invalid secret value")
                    if value!=self.runtime_secrets.data[project_id]["pending"][name]["value"]:
                        self.runtime_secrets.stage_migration(project_id,name,source_name,value)
                    raise WebgenOperationError("migration_source_still_exists",409)
            else:
                candidates=self._legacy_secret_candidates(slug,api_key); candidate=next((item for item in candidates if item["source_name"]==source_name),None)
                if not candidate: raise WebgenOperationError("migration_candidate_not_found",404)
                if candidate["ambiguous"] and confirm_ambiguous is not True: raise WebgenOperationError("migration_confirmation_required",409)
                name=candidate["runtime_name"]
                if name in {x["name"] for x in self.runtime_secrets.list(project_id)["secrets"]}: raise WebgenOperationError("runtime_secret_exists",409)
                try: raw=self._secret_request(api_key,"/api/settings/secrets/"+quote(source_name,safe=""),65536)
                except WebgenOperationError as error:
                    if error.code=="agent_secret_not_found": raise WebgenOperationError("migration_candidate_not_found",404) from error
                    raise
                try: value=raw.decode("utf-8")
                except UnicodeError: raise SecretMaterializationError("invalid secret encoding")
                if not self._valid_runtime_secret_value(value): raise SecretMaterializationError("invalid secret value")
                self.runtime_secrets.stage_migration(project_id,name,source_name,value)
                return {"name":name,"configured":False,"source_removed":False,"pending":True}
    def _write_project_env(self,p,lines,target=None):
        target=Path(target) if target is not None else p/".env"
        if target.is_symlink(): raise SecretMaterializationError("invalid environment path")
        try: resolved=target.resolve()
        except OSError: raise SecretMaterializationError("invalid environment path") from None
        root=p.resolve()
        if resolved==root or root not in resolved.parents or (target.exists() and not target.is_file()): raise SecretMaterializationError("invalid environment path")
        content=("\n".join(lines)+"\n").encode("utf-8")
        owner=target.stat() if target.exists() else p.stat()
        if target.exists() and owner.st_uid==os.geteuid() and owner.st_gid==os.getegid() and stat.S_IMODE(owner.st_mode)==0o600:
            try:
                if target.read_bytes()==content: return
            except OSError: pass
        tmp=target.with_name("."+target.name+".tmp-"+secrets.token_hex(8))
        try:
            with open(tmp,"w",encoding="utf-8",newline="\n") as output:
                output.write(content.decode("utf-8")); output.flush(); os.fsync(output.fileno())
            os.chown(tmp,owner.st_uid,owner.st_gid); os.chmod(tmp,0o600); os.replace(tmp,target)
        finally: tmp.unlink(missing_ok=True)
    @contextmanager
    def materialize_env(self,slug,p,base_path):
        project_id=self._ensure_project_id(slug,p)
        _,source,app,env_files=self._source_compose(p)
        default_env=(p/".env").resolve(); env_file_keys=set()
        for env_file in env_files:
            if env_file==default_env: continue
            try: lines,keys=self._safe_env_file_lines(p,env_file)
            except EnvironmentReviewRequired:
                self._quarantine_legacy_env(p,env_file)
                raise EnvironmentReviewRequired(env_file.name) from None
            self._write_project_env(p,lines,env_file)
            env_file_keys.update(keys)
        env_keys=self.project_env_keys(p,source,app,env_files)
        env_keys.update(env_file_keys)
        values=self.runtime_secrets.values(project_id)
        if any(not self._valid_runtime_secret_name(k) or not self._valid_runtime_secret_value(v) for k,v in values.items()): raise SecretMaterializationError("invalid runtime secret")
        required={key for key in env_keys if self._secret_environment_key(key)}
        metadata=self.metadata(p)
        auth=metadata.get("authProvider")
        if auth=="better-auth" or metadata.get("needsDatabase") is True: required.add("DATABASE_URL")
        if auth=="better-auth": required.add("BETTER_AUTH_SECRET")
        missing=required-set(values)
        if missing: raise SecretMaterializationError("required project secrets are missing")
        environment=app.get("environment",{})
        environment_names=set(environment) if isinstance(environment,dict) else {item.split("=",1)[0] for item in environment if isinstance(item,str)} if isinstance(environment,list) else set()
        if environment_names.intersection(values): raise SecretMaterializationError("remove_runtime_secrets_from_compose_environment",422,"runtime_secret_compose_conflict")
        build=app.get("build") or {}; build=build if isinstance(build,dict) else {}
        args=build.get("args",{}); arg_names=set(args) if isinstance(args,dict) else {item.split("=",1)[0] for item in args if isinstance(item,str)} if isinstance(args,list) else set()
        if arg_names.intersection(values): raise SecretMaterializationError("runtime_secrets_cannot_be_build_args",422,"runtime_secret_build_arg")
        self._write_project_env(p,self._safe_env_lines(p,base_path,require_manual_review=True))
        runtime_dir=Path(getattr(self,"runtime_dir",self.state/"runtime"))
        runtime_dir.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(runtime_dir,0o700)
        with tempfile.TemporaryDirectory(prefix="webgen-runtime-",dir=runtime_dir) as temporary:
            target=Path(temporary)/"runtime.env"; owner=self.state.stat()
            try:
                with open(target,"w",encoding="utf-8",newline="\n") as output:
                    for key,value in sorted(values.items()): output.write(key+"="+self._dotenv_quote(value)+"\n")
                    output.flush(); os.fsync(output.fileno())
                os.chown(target,owner.st_uid,owner.st_gid); os.chmod(target,0o600)
                yield target
            finally: target.unlink(missing_ok=True)
    def active_base_path(self,slug):
        p=safe_project(self.root,slug)
        return "" if p and self._published_label(self.metadata(p)) else f"/preview/{slug}"
    def app_target(self,slug,base_path=None):
        if base_path is None: base_path=self.active_base_path(slug)
        try:
            r=subprocess.run(["docker","inspect","--format","{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",slug+"-app"],capture_output=True,text=True,timeout=3,check=False); ip=r.stdout.strip().splitlines()[-1] if r.returncode==0 else ""
            return f"http://{ip}:3000{base_path}/api/dck/owner-seed" if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}",ip) else None
        except (OSError,subprocess.TimeoutExpired): return None
    def owner_state(self,slug,base_path=None):
        u=self.app_target(slug,base_path)
        if not u:return "unreachable"
        try:
            with urlopen(Request(u),timeout=3) as r:return json.loads(r.read(8192)).get("state")
        except Exception:return "unreachable"
    def deliver_seed(self,slug,p,conversation,base_path=None):
        r,e,u,pw=self.seed.peek(slug,conversation); issued=int(time.time()); expires=issued+120; signed=canonical_signed_payload(1,slug,conversation,issued,expires,r.nonce,e,u,pw); sig=self.seed.private_for(slug).sign(signed); body=json.dumps({"version":1,"project_slug":slug,"conversation_id":conversation,"issued_at":issued,"expires_at":expires,"nonce":r.nonce,"email":e,"username":u,"password":pw,"signature":base64.b64encode(sig).decode()},ensure_ascii=False,separators=(",",":")).encode(); target=self.app_target(slug,base_path)
        if not target:return False
        try:
            with urlopen(Request(target,data=body,headers={"Content-Type":"application/json"},method="POST"),timeout=10) as x: ok=x.status in (200,201,409)
        except HTTPError as x: ok=x.code==409
        except Exception: ok=False
        if ok:self.seed.consume(slug,conversation)
        return ok
    def nginx_reload(self,expected_config=None):
        subprocess.run(["nginx","-t"],capture_output=True,timeout=10,check=True)
        if expected_config is not None:
            rendered=subprocess.run(["nginx","-T"],capture_output=True,text=True,timeout=10,check=True)
            output=(rendered.stdout or "")+"\n"+(rendered.stderr or "")
            if str(expected_config) not in output: raise RuntimeError("nginx route configuration is not included")
        subprocess.run(["systemctl","reload","nginx"],capture_output=True,timeout=10,check=True)
    def _nginx_file(self,slug,kind):
        if self.nginx.is_symlink() or (self.nginx.exists() and not self.nginx.is_dir()): raise RuntimeError("invalid nginx directory")
        self.nginx.mkdir(parents=True,exist_ok=True); f=self.nginx/(f"published-{slug}.conf" if kind=="published" else f"preview-{slug}.conf")
        if f.is_symlink(): raise RuntimeError("invalid nginx target")
        return f
    def config(self,slug,m,preview,sub=None):
        port=self.port(m)
        if preview:
            proxy=(f" proxy_pass http://127.0.0.1:{port};\n"
                    " proxy_http_version 1.1;\n"
                    " proxy_set_header Host $host;\n"
                    " proxy_set_header X-Real-IP $remote_addr;\n"
                    " proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
                    " proxy_set_header X-Forwarded-Proto $scheme;\n"
                    " proxy_set_header Upgrade $http_upgrade;\n"
                    " proxy_set_header Connection \"upgrade\";\n")
            return "".join(f"location {location} {{\n{proxy}}}\n" for location in (f"= /preview/{slug}",f"/preview/{slug}/"))
        if not valid_subdomain(sub or ""): raise ValueError("invalid subdomain")
        host=sub+".dckautoposting.com"
        proxy=(f"proxy_pass http://127.0.0.1:{port}/; proxy_http_version 1.1; "
               "proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; "
               "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; "
               "proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Upgrade $http_upgrade; "
               "proxy_set_header Connection \"upgrade\";")
        return ("server {\n listen 443 ssl;\n listen [::]:443 ssl;\n"
                f" server_name {host};\n"
                " ssl_certificate /etc/letsencrypt/live/dckautoposting.com/fullchain.pem;\n"
                " ssl_certificate_key /etc/letsencrypt/live/dckautoposting.com/privkey.pem;\n"
                " include /etc/letsencrypt/options-ssl-nginx.conf;\n"
                " ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;\n"
                f" location / {{ {proxy} }}\n}}\n"
                f"server {{ listen 80; listen [::]:80; server_name {host}; return 301 https://$host$request_uri; }}\n")
    def update_meta(self,p,**changes): m=self.metadata(p); m.update(changes); atomic_json(p/".dck.json",m)
    def _health(self,slug,port,path="/",timeout=3):
        try:
            r=subprocess.run(["docker","inspect","--format","{{.State.Status}}" ,slug+"-app"],capture_output=True,text=True,timeout=timeout,check=False)
            if r.returncode or r.stdout.strip().lower()!="running": return False
            with socket.create_connection(("127.0.0.1",port),timeout=timeout) as s:
                request=("GET "+path+" HTTP/1.0\r\nHost: localhost\r\n\r\n").encode("ascii"); s.sendall(request); line=s.recv(64).splitlines()[0].decode("ascii","ignore")
            mm=re.match(r"HTTP/\d(?:\.\d)?\s+(\d{3})",line); return bool(mm and 200<=int(mm.group(1))<400)
        except Exception:return False
    def wait_ready(self,slug,port,path="/",timeout=None):
        timeout=float(timeout if timeout is not None else os.getenv("WEBGEN_READINESS_TIMEOUT", "120"))
        if not 0<timeout<=300: raise ValueError("invalid readiness timeout")
        deadline=time.monotonic()+timeout
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0: raise WebgenOperationError("readiness_timeout",503)
            if self._health(slug,port,path,timeout=min(3,remaining/4)): return
            remaining=deadline-time.monotonic()
            if remaining<=0: raise WebgenOperationError("readiness_timeout",503)
            state=subprocess.run(["docker","inspect","--format","{{.State.Status}}",slug+"-app"],capture_output=True,text=True,timeout=min(3,remaining),check=False)
            if state.stdout.strip() in {"exited","dead"}: raise WebgenOperationError("application_exited",503)
            time.sleep(min(2,max(0,deadline-time.monotonic())))
    def _atomic_bytes(self,path,data,mode):
        parent=path.parent.stat(); tmp=path.with_name(path.name+".tmp-"+secrets.token_hex(8))
        try:
            with open(tmp,"wb") as output: output.write(data); output.flush(); os.fsync(output.fileno())
            os.chown(tmp,parent.st_uid,parent.st_gid); os.chmod(tmp,mode); os.replace(tmp,path)
        finally: tmp.unlink(missing_ok=True)
    def _snapshot_routes(self,slug):
        files=(self._nginx_file(slug,"published"),self._nginx_file(slug,"preview"))
        return {f:(f.read_bytes() if f.exists() else None) for f in files}
    def _restore_routes(self,snapshot):
        for path,data in snapshot.items():
            if data is None: path.unlink(missing_ok=True)
            else: self._atomic_bytes(path,data,0o644)
    def _set_route(self,slug,p,meta,subdomain):
        published=self._nginx_file(slug,"published"); preview=self._nginx_file(slug,"preview")
        if subdomain:
            self._atomic_bytes(published,self.config(slug,meta,False,subdomain).encode(),0o644); preview.unlink(missing_ok=True)
            changes={"subdomain":subdomain+".dckautoposting.com","previewPath":None}
        else:
            self._atomic_bytes(preview,self.config(slug,meta,True).encode(),0o644); published.unlink(missing_ok=True)
            changes={"subdomain":None,"previewPath":f"/preview/{slug}"}
        route_config=published if subdomain else preview
        self.nginx_reload(expected_config=route_config)
        self.update_meta(p,**changes)
    def _published_label(self,meta):
        domain=meta.get("subdomain")
        suffix=".dckautoposting.com"
        if isinstance(domain,str) and domain.endswith(suffix) and valid_subdomain(domain[:-len(suffix)]): return domain[:-len(suffix)]
        return None
    def _ensure_unique_subdomain(self,slug,subdomain):
        target=self._nginx_file(slug,"published")
        for path in self.nginx.glob("*.conf"):
            if path!=target and not path.is_symlink() and subdomain+".dckautoposting.com" in path.read_text(encoding="utf-8",errors="ignore"): raise ValueError("duplicate server name")
    def action(self,slug,body,session_api_key=None):
        p=safe_project(self.root,slug)
        if not p: raise KeyError
        action=body.get("action"); conv=body.get("conversation_id")
        if action not in ACTIONS: raise ValueError("invalid action")
        if "subdomain" in body and action!="publish": raise ValueError("subdomain requires publish")
        with self.lock_for(slug):
            if action in {"publish","unpublish","deploy","rebuild","start","restart","delete"}: self._ensure_project_id(slug,p)
            m=self.metadata(p); port=self.port(m)
            if action in {"publish","unpublish"}:
                current=self._published_label(m)
                sub=body.get("subdomain") or slug if action=="publish" else None
                if action=="publish" and not valid_subdomain(sub): raise ValueError("invalid subdomain")
                if action=="unpublish" and not current: raise ValueError("project is not published")
                if action=="publish":
                    self._ensure_unique_subdomain(slug,sub)
                    if m.get("authProvider")=="better-auth" and self.owner_state(slug)!="owner_exists": raise OwnerSeedUnavailable()
                oldmeta=(p/".dck.json").read_bytes(); oldroutes=self._snapshot_routes(slug); old_base="" if current else f"/preview/{slug}"; runtime_changed=False
                try:
                    self.ensure_generated_runtime_secrets(slug,p)
                    self.run_project_migrations(slug,p)
                    with self.materialize_env(slug,p,"" if action=="publish" else f"/preview/{slug}") as runtime_env_file:
                        r=self.compose(slug,p,"rebuild",runtime_env_file)
                        if r.returncode: raise RuntimeError("rebuild failed")
                        runtime_changed=True
                        path="/" if action=="publish" else f"/preview/{slug}/"
                        self.wait_ready(slug,port,path)
                        self._set_route(slug,p,m,sub if action=="publish" else None)
                        self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso())
                except SecretMaterializationError: raise
                except Exception as failure:
                    self._restore_routes(oldroutes)
                    self._atomic_bytes(p/".dck.json",oldmeta,0o644)
                    restored=not runtime_changed
                    if runtime_changed:
                        try:
                            with self.materialize_env(slug,p,old_base) as runtime_env_file:
                                rollback=self.compose(slug,p,"rebuild",runtime_env_file)
                                restored=rollback.returncode==0
                                if restored: self.wait_ready(slug,port,old_base+"/" if old_base else "/")
                        except Exception: restored=False
                    if restored:
                        try:self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso())
                        except Exception:pass
                    else:
                        try:self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso())
                        except Exception:pass
                    try:self.nginx_reload()
                    except Exception:pass
                    if not restored: raise WebgenOperationError("rollback_failed") from failure
                    if isinstance(failure,WebgenOperationError): raise failure
                    raise WebgenOperationError("publication_failed") from failure
                return self.project(slug,p)
            if action in {"deploy","rebuild","start","restart"} and m.get("authProvider")=="better-auth":
                if not valid_conversation(conv): raise ValueError("conversation_id required")
                state=self.owner_state(slug)
                if state not in {"owner_exists"} and not self.seed.authorized(slug,conv): raise OwnerSeedUnavailable()
            if action=="delete": return self._delete(slug,p)
            if action=="stop":
                r=self.compose(slug,p,action)
                if r.returncode: self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("compose operation failed")
                self.update_meta(p,lastStatus="stopped",lastCheckedAt=now_iso()); return self.project(slug,p)
            current=self._published_label(m)
            target=current
            base="" if target else f"/preview/{slug}"
            self.ensure_generated_runtime_secrets(slug,p)
            self.run_project_migrations(slug,p)
            with self.materialize_env(slug,p,base) as runtime_env_file:
                r=self.compose(slug,p,action,runtime_env_file)
            if r.returncode: self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("compose operation failed")
            try:
                self.wait_ready(slug,port,base+"/" if base else "/")
                if m.get("authProvider")=="better-auth" and self.owner_state(slug,base)!="owner_exists" and not self.deliver_seed(slug,p,conv,base): raise WebgenOperationError("owner_seed_delivery_failed",503)
            except Exception:
                self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise
            routes=self._snapshot_routes(slug); oldmeta=(p/".dck.json").read_bytes()
            try:
                self._set_route(slug,p,m,target)
            except Exception:
                self._restore_routes(routes); self._atomic_bytes(p/".dck.json",oldmeta,0o644)
                try:self.nginx_reload()
                except Exception:pass
                self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("route update failed")
            self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso()); return self.project(slug,p)
    def postgres_command(self,sql):
        user=os.getenv("WEBGEN_POSTGRES_USER", "dck")
        container=os.getenv("WEBGEN_POSTGRES_CONTAINER","dck-postgres")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*",user) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}",container): raise ValueError("invalid postgres target")
        return ["docker","exec",container,"psql","-U",user,"-d","postgres","-v","ON_ERROR_STOP=1","-c",sql]
    def _delete(self,slug,p):
        meta=self.metadata(p)
        project_id=meta.get("projectId")
        needs_db=meta.get("needsDatabase") is not False or meta.get("authProvider")=="better-auth"
        stored_values=self.runtime_secrets.values(project_id) if isinstance(project_id,str) else {}
        database=self._database_name(slug); runtime_role=self._runtime_database_role(slug); migration_role=self._migration_database_role(slug)
        managed=self.runtime_secrets.managed_database(project_id) if isinstance(project_id,str) else None
        delete_project_database=needs_db and self._matches_project_database_url(stored_values.get("DATABASE_URL"),slug)
        if delete_project_database:
            if not managed or managed.get("database")!=database or managed.get("runtime_role")!=runtime_role or managed.get("migration_role")!=migration_role:
                raise WebgenOperationError("database_cleanup_unverified",409)
            db_literal=self._pg_literal(database); runtime_literal=self._pg_literal(runtime_role); migration_literal=self._pg_literal(migration_role)
            actual_owner=self._run_postgres_script(f"SELECT r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname={db_literal};",tuples_only=True).stdout.strip()
            if actual_owner and actual_owner!=migration_role: raise WebgenOperationError("database_cleanup_unverified",409)
            unsafe=self._run_postgres_script(
                f"SELECT 1 FROM pg_roles r WHERE r.rolname IN ({runtime_literal},{migration_literal}) AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) OR EXISTS (SELECT 1 FROM pg_tablespace t WHERE t.spcowner=r.oid) OR (r.rolname={runtime_literal} AND EXISTS (SELECT 1 FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o')) OR (r.rolname={migration_literal} AND EXISTS (SELECT 1 FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o' AND NOT ((s.dbid=0 AND s.classid='pg_database'::regclass AND s.objid=(SELECT oid FROM pg_database WHERE datname={db_literal})) OR s.dbid=(SELECT oid FROM pg_database WHERE datname={db_literal})))) LIMIT 1;",
                tuples_only=True,
            ).stdout.strip()
            if unsafe: raise WebgenOperationError("database_cleanup_unverified",409)
        if needs_db:
            probe=subprocess.run(self.postgres_command("SELECT 1"),capture_output=True,text=True,timeout=10,check=False)
            if probe.returncode: raise WebgenOperationError("database_unavailable",503)
        old=self._snapshot_routes(slug); was_running=self.project(slug,p,self.all_container_status()).get("status")=="running"
        try:
            for f in old: f.unlink(missing_ok=True)
            self.nginx_reload()
            down=self.compose(slug,p,"delete")
            if down.returncode: raise RuntimeError("container cleanup failed")
            shutil.rmtree(p)
            if delete_project_database:
                owner=self._run_postgres_script(f"SELECT r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname={self._pg_literal(database)};",tuples_only=True).stdout.strip()
                if owner and owner!=migration_role: raise WebgenOperationError("database_cleanup_unverified",409)
                db=self._run_postgres_script(f'DROP DATABASE IF EXISTS {self._pg_identifier(database)} WITH (FORCE);',timeout=30)
                if db.returncode: raise WebgenOperationError("database_cleanup_failed")
                for cleanup_role in (runtime_role,migration_role):
                    role_cleanup=self._run_postgres_script(f'DROP ROLE IF EXISTS {self._pg_identifier(cleanup_role)}',timeout=30)
                    if role_cleanup.returncode: raise WebgenOperationError("database_cleanup_failed")
            self.runtime_secrets.delete_project(project_id)
            return {"slug":slug,"path":f"/projects/webgen/{slug}","name":None,"port":None,"stack":None,"auth_provider":None,"preview_path":None,"subdomain":None,"has_deployment":False,"status":"stopped","last_checked_at":now_iso(),"containers":[]}
        except Exception as failure:
            if not p.exists():
                try:self.nginx_reload()
                except Exception:pass
                raise WebgenOperationError("delete_recovery_required",503) from failure
            self._restore_routes(old)
            if was_running and p.exists():
                try:
                    base="" if self._published_label(self.metadata(p)) else f"/preview/{slug}"
                    with self.materialize_env(slug,p,base) as runtime_env_file:
                        self.compose(slug,p,"deploy",runtime_env_file)
                except Exception:pass
            try:self.nginx_reload()
            except Exception:pass
            self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso())
            if isinstance(failure,WebgenOperationError): raise failure
            raise WebgenOperationError("delete_failed")

class Handler(BaseHTTPRequestHandler):
    server_version="webgen-control/1"
    def log_message(self,*a): pass
    @property
    def svc(self): return self.server.service
    def send(self,c,o):
        b=json.dumps(o,ensure_ascii=False,separators=(",",":")).encode(); self.send_response(c); self.send_header("Content-Type","application/json"); self.send_header("Cache-Control","no-store"); self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def auth(self):
        key=self.headers.get("X-Session-API-Key")
        if not isinstance(key,str) or not key:return self.send(401,{"error":"unauthorized"}) or False
        try:
            with urlopen(Request(self.svc.canvas,headers={"X-Session-API-Key":key}),timeout=3) as r:r.read(1024); return True
        except HTTPError as e:self.send(e.code if e.code==401 else 503,{"error":"unauthorized" if e.code==401 else "auth_unavailable"}); return False
        except Exception:self.send(503,{"error":"auth_unavailable"}); return False
    def runtime_store_ready(self):
        if self.svc.runtime_secrets.healthy: return True
        self.send(503,{"error":"runtime_secret_store_unavailable"})
        return False
    def body(self):
        if self.headers.get_content_type()!="application/json": raise ValueError("json required")
        raw=self.headers.get("Content-Length")
        if not raw or not raw.isdigit() or int(raw)>MAX_BODY: raise ValueError("body too large")
        d=json.loads(self.rfile.read(int(raw)))
        if not isinstance(d,dict): raise ValueError("object required")
        return d
    def do_GET(self):
        if self.path=="/healthz":
            if not self.runtime_store_ready(): return
            return self.send(200,{"status":"ok"})
        if self.path=="/api/webgen/projects":
            if not self.auth(): return
            if not self.runtime_store_ready(): return
            return self.send(200,{"projects":self.svc.projects()})
        m=re.fullmatch(r"/api/webgen/projects/([^/]+)/runtime-secrets",self.path)
        if m:
            if not self.auth(): return
            if not self.runtime_store_ready(): return
            slug=m.group(1)
            if not valid_slug(slug): return self.send(400,{"error":"invalid_identifier"})
            p=safe_project(self.svc.root,slug)
            if not p: return self.send(404,{"error":"not_found"})
            try:
                with self.svc.lock_for(slug): return self.send(200,self.svc.runtime_secret_payload(slug,p,self.headers.get("X-Session-API-Key")))
            except (SecretMaterializationError,WebgenOperationError) as e: return self.send(e.status,{"error":e.code})
            except Exception: return self.send(500,{"error":"operation_failed"})
        m=re.fullmatch(r"/api/webgen/projects/([^/]+)/runtime-secrets/([A-Za-z][A-Za-z0-9_]{0,63})/value",self.path)
        if m:
            if not self.auth(): return
            if not self.runtime_store_ready(): return
            slug,name=m.groups()
            if not valid_slug(slug) or not self.svc._valid_runtime_secret_name(name): return self.send(400,{"error":"invalid_identifier"})
            p=safe_project(self.svc.root,slug)
            if not p: return self.send(404,{"error":"not_found"})
            try:
                with self.svc.lock_for(slug):
                    project_id=self.svc._ensure_project_id(slug,p)
                    value=self.svc.runtime_secrets.reveal(project_id,name)
                return self.send(200,{"name":name,"value":value})
            except (SecretMaterializationError,WebgenOperationError) as e: return self.send(e.status,{"error":e.code})
            except Exception: return self.send(500,{"error":"operation_failed"})
        self.send(404,{"error":"not_found"})
    def do_POST(self):
        if not self.auth():return
        if not self.runtime_store_ready(): return
        try:
            d=self.body(); m=re.fullmatch(r"/api/webgen-provisioning/projects/([^/]+)/conversations/([^/]+)/(seed|authorize-deploy)",self.path)
            if m:
                slug,conv,op=m.groups()
                if not valid_slug(slug) or not valid_conversation(conv):return self.send(400,{"error":"invalid_identifier"})
                if op=="seed": return self.send(200,self.svc.seed.stage(slug,conv,d.get("email"),d.get("username"),d.get("password")))
                if self.svc.owner_state(slug)=="owner_exists":return self.send(200,{"status":"already_provisioned"})
                return self.send(200,self.svc.seed.authorize(slug,conv))
            m=re.fullmatch(r"/api/webgen/projects/([^/]+)/actions",self.path)
            if m:return self.send(200,{"project":self.svc.action(m.group(1),d,self.headers.get("X-Session-API-Key"))})
            m=re.fullmatch(r"/api/webgen/projects/([^/]+)/runtime-secrets/migrations",self.path)
            if m:
                slug=m.group(1)
                if not valid_slug(slug):return self.send(400,{"error":"invalid_identifier"})
                p=safe_project(self.svc.root,slug)
                if not p:return self.send(404,{"error":"not_found"})
                if set(d)-{"source_name","confirm_ambiguous"} or not isinstance(d.get("confirm_ambiguous",False),bool):return self.send(400,{"error":"invalid_request"})
                with self.svc.lock_for(slug): result=self.svc.migrate_runtime_secret(slug,p,self.headers.get("X-Session-API-Key"),d.get("source_name"),d.get("confirm_ambiguous",False))
                return self.send(200,result)
            self.send(404,{"error":"not_found"})
        except (SecretMaterializationError,WebgenOperationError) as e:self.send(e.status,{"error":e.code})
        except (ValueError,KeyError,json.JSONDecodeError):self.send(400,{"error":"invalid_request"})
        except OverflowError:self.send(429,{"error":"capacity"})
        except RuntimeError as e:self.send(410 if "authorization" in str(e) else 500,{"error":"owner_authorization_required" if "authorization" in str(e) else "operation_failed"})
        except Exception:self.send(500,{"error":"operation_failed"})
    def do_PUT(self):
        if not self.auth(): return
        if not self.runtime_store_ready(): return
        try:
            d=self.body(); m=re.fullmatch(r"/api/webgen/projects/([^/]+)/runtime-secrets",self.path)
            if not m:return self.send(404,{"error":"not_found"})
            slug=m.group(1)
            if not valid_slug(slug):return self.send(400,{"error":"invalid_identifier"})
            if set(d)-{"name","value","sensitive"} or not {"name","value"}<=set(d) or not self.svc._valid_runtime_secret_name(d.get("name")):return self.send(400,{"error":"invalid_secret_name"})
            if "sensitive" in d and not isinstance(d["sensitive"],bool):return self.send(400,{"error":"invalid_classification"})
            if not isinstance(d.get("value"),str) or not self.svc._valid_runtime_secret_value(d["value"]):return self.send(422,{"error":"invalid_secret_value"})
            p=safe_project(self.svc.root,slug)
            if not p:return self.send(404,{"error":"not_found"})
            with self.svc.lock_for(slug):
                project_id=self.svc._ensure_project_id(slug,p); result=self.svc.runtime_secrets.put(project_id,d["name"],d["value"],d.get("sensitive"))
            return self.send(200,result)
        except (SecretMaterializationError,WebgenOperationError) as e:self.send(e.status,{"error":e.code})
        except (ValueError,KeyError,json.JSONDecodeError):self.send(400,{"error":"invalid_request"})
        except Exception:self.send(500,{"error":"operation_failed"})
    def do_DELETE(self):
        if not self.auth(): return
        if not self.runtime_store_ready(): return
        try:
            m=re.fullmatch(r"/api/webgen/projects/([^/]+)/runtime-secrets/([A-Za-z][A-Za-z0-9_]{0,63})",self.path)
            if not m:return self.send(404,{"error":"not_found"})
            slug,name=m.groups()
            if not valid_slug(slug) or not self.svc._valid_runtime_secret_name(name):return self.send(400,{"error":"invalid_identifier"})
            p=safe_project(self.svc.root,slug)
            if not p:return self.send(404,{"error":"not_found"})
            with self.svc.lock_for(slug):
                project_id=self.svc._ensure_project_id(slug,p); self.svc.runtime_secrets.delete(project_id,name)
            return self.send(200,{"deleted":True})
        except (SecretMaterializationError,WebgenOperationError) as e:self.send(e.status,{"error":e.code})
        except (ValueError,KeyError,json.JSONDecodeError):self.send(400,{"error":"invalid_request"})
        except Exception:self.send(500,{"error":"operation_failed"})
def main():
    host=os.getenv("WEBGEN_BIND_HOST","172.17.0.1"); import ipaddress
    try:
        ip=ipaddress.ip_address(host)
        if not ip.is_private or ip.is_unspecified: raise RuntimeError("refusing public bind")
    except ValueError: raise RuntimeError("invalid bind address")
    s=ThreadingHTTPServer((host,int(os.getenv("WEBGEN_CONTROL_PORT","8769"))),Handler); s.service=Service(); s.serve_forever()
if __name__=="__main__": main()
