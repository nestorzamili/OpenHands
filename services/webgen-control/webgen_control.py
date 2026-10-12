#!/usr/bin/env python3
"""Root-run WebGen control service.  All external commands use fixed argv vectors."""
from __future__ import annotations
import base64, json, os, re, secrets, shutil, socket, subprocess, tempfile, threading, time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
import yaml

SLUG_RE=re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CONV_RE=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
DNS_RE=re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
EMAIL_RE=re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RESERVED={"agent","www","api","mail","smtp","ftp","admin","root","ns1","ns2","localhost"}
SECRET_NAME_RE=re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
ENV_KEY_RE=re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ENV_LINE_RE=re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
ACTIONS={"deploy","rebuild","start","restart","stop","delete","publish","unpublish"}; MAX_BODY=16*1024; UTC=timezone.utc

class SecretMaterializationError(RuntimeError):
    def __init__(self,message,status=422,code="secrets_required"):
        super().__init__(message); self.status=status; self.code=code

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
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    try:
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(fd,secrets.token_bytes(32)); os.fsync(fd); os.close(fd)
    except FileExistsError: pass
    os.chmod(path,0o600); key=path.read_bytes()
    if len(key)!=32: raise RuntimeError("invalid master key")
    return key
@dataclass
class StoredSeed: slug:str; conversation:str; nonce:str; issued:int; expires:int; blob:bytes; authorized_until:int=0
class SeedStore:
    def __init__(self,ttl=900,max_records=128,master_path=None):
        self.ttl=min(max(1,int(ttl)),900); self.max_records=max_records; self.aead=AESGCM(AESGCM.generate_key(256)); self.master=_master_key(master_path or os.getenv("WEBGEN_CONTROL_KEY","/opt/dck-agentic/config/webgen-control.key")); self.lock=threading.Lock(); self.records={}
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
            if not r: raise KeyError
            r.authorized_until=min(r.expires,int(time.time())+300); return {"status":"authorized"}
    def peek(self,slug,conversation):
        with self.lock:
            self._drop(); r=self.records.get((slug,conversation))
            if not r or r.authorized_until<int(time.time()): raise KeyError
            plain=self.aead.decrypt(r.blob[:12],r.blob[12:],(slug+"\0"+conversation).encode()); e,u,p=json.loads(plain.decode()); return r,e,u,p
    def consume(self,slug,conversation):
        with self.lock:
            r=self.records.get((slug,conversation));
            if not r or r.authorized_until<int(time.time()): raise KeyError
            plain=self.aead.decrypt(r.blob[:12],r.blob[12:],(slug+"\0"+conversation).encode()); e,u,p=json.loads(plain.decode())
            self.records.pop((slug,conversation),None); return r,e,u,p
class Service:
    def __init__(self):
        self.workspace=Path(os.getenv("WEBGEN_WORKSPACE_ROOT","/opt/dck-agentic/workspace")).resolve(); self.root=self.workspace/"webgen"; self.nginx=Path(os.getenv("WEBGEN_NGINX_DIR","/etc/nginx/dck-apps")); self.canvas=os.getenv("WEBGEN_CANVAS_AUTH_URL","http://127.0.0.1:8010/api/workspaces"); self.seed=SeedStore(); self.locks={}; self.guard=threading.Lock(); self.build_lock=threading.RLock(); self._validate_canvas()
    def _validate_canvas(self):
        u=urlparse(self.canvas)
        if u.scheme!="http" or u.hostname not in {"127.0.0.1","localhost"} or (u.port or 80)!=8010 or u.path!="/api/workspaces": raise RuntimeError("invalid canvas auth URL")
    def lock_for(self,s):
        with self.guard: return self.locks.setdefault(s,threading.Lock())
    def metadata(self,p):
        try:
            path=p/".dck.json"
            if path.is_symlink(): return {}
            m=json.loads(path.read_text())
            return m if isinstance(m,dict) else {}
        except (OSError,ValueError): return {}
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
                ir=subprocess.run(["docker","inspect","--format","{{.Id}}|{{.State.ExitCode}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}"]+ids,capture_output=True,text=True,timeout=3,check=False)
                if ir.returncode: return None
                info={x.split("|",2)[0]:x.split("|",2) for x in ir.stdout.splitlines() if len(x.split("|",2))==3}
                for d in raw:
                    x=next((v for k,v in info.items() if k.startswith(d["id"])),None)
                    if x:
                        try:d["exit_code"]=int(x[1])
                        except ValueError: pass
                        d["health"]=x[2] or d["health"]
            except (OSError,subprocess.TimeoutExpired): return None
        return self.group_containers(raw)
    def project(self,slug,p,status_groups=None):
        m=self.metadata(p); unknown=status_groups is None; cs=[{k:x.get(k) for k in ("id","name","state","health","exit_code")} for x in (status_groups or {}).get(slug,[])]; states=[str(x.get("state") or "").lower() for x in cs]
        if unknown: status="unknown"
        elif any(x.get("health")=="unhealthy" or (x.get("exit_code") not in (None,0) and str(x.get("state") or "").lower()=="exited") for x in cs): status="error"
        elif any(state in {"running","restarting","created"} for state in states): status="running"
        elif cs: status="stopped"
        else: status="error" if m.get("lastStatus")=="error" else "stopped"
        checked=now_iso() if not unknown else m.get("lastCheckedAt")
        try: port=self.port(m)
        except ValueError: port=None
        name=m.get("name"); name=name[:100] if isinstance(name,str) and name.strip() else slug
        stack=m.get("stack"); stack=stack[:64] if isinstance(stack,str) else None
        auth=m.get("authProvider",m.get("auth_provider")); auth=auth.lower()[:64] if isinstance(auth,str) else None
        expected_preview=f"/preview/{slug}"; preview=expected_preview if m.get("previewPath")==expected_preview else None
        domain=m.get("subdomain"); subdomain=None
        if isinstance(domain,str) and domain.endswith(".dckautoposting.com") and valid_subdomain(domain[:-len(".dckautoposting.com")]): subdomain=domain
        return {"slug":slug,"path":f"/projects/webgen/{slug}","name":name,"port":port,"stack":stack,"auth_provider":auth,"preview_path":preview,"subdomain":subdomain,"status":status,"last_checked_at":checked,"containers":cs}
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
    def compose_config(self,slug,p,compose_file=None,source_bytes=None):
        cf,source,app,env_files=self._source_compose(p,source_bytes); compose_file=compose_file or cf; m=self.metadata(p); port=self.port(m)
        clean_env={"PATH":os.getenv("PATH","/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),"HOME":"/root","COMPOSE_PARALLEL_LIMIT":"1"}
        try:r=subprocess.run(["docker","compose","-f",str(compose_file),"-p",slug,"--project-directory",str(p),"config","--format","json"],cwd=str(p),capture_output=True,text=True,timeout=30,check=False,env=clean_env)
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
    def compose(self,slug,p,action):
        clean_env={"PATH":os.getenv("PATH","/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),"HOME":"/root","COMPOSE_PARALLEL_LIMIT":"1"}
        source=p/"docker-compose.yml"
        if not source.is_file() or source.is_symlink() or source.stat().st_size>1024*1024: raise ValueError("invalid compose")
        source_bytes=source.read_bytes()
        with self.build_lock:
            with tempfile.TemporaryDirectory(prefix="webgen-compose-") as temporary:
                snapshot=Path(temporary)/"docker-compose.yml"; snapshot.write_bytes(source_bytes); os.chmod(snapshot,0o400)
                self.compose_config(slug,p,compose_file=snapshot,source_bytes=source_bytes)
                base=["docker","compose","-p",slug,"-f",str(snapshot),"--project-directory",str(p)]
                commands=[]
                if action in {"rebuild","restart"}: commands.append(base+["down","--remove-orphans"])
                commands.append(command_for(slug,action,snapshot,p))
                for command in commands:
                    result=subprocess.run(command,cwd=str(p),capture_output=True,text=True,timeout=900,check=False,env=clean_env)
                    if result.returncode: return result
                return result
    @staticmethod
    def _secret_environment_key(name):
        upper=name.upper()
        return upper in {"DATABASE_URL","REDIS_URL","BETTER_AUTH_SECRET"} or any(term in upper for term in ("_SECRET","PASSWORD","_TOKEN","API_KEY","PRIVATE_KEY"))
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
        except Exception: raise SecretMaterializationError("secret manager unavailable",503,"secret_manager_unavailable")
        if len(data)>max_bytes: raise SecretMaterializationError("secret response too large",502,"invalid_secret_response")
        return data
    def _project_secret_values(self,slug,api_key):
        suffix="_"+slug.upper().replace("-","_")
        raw=self._secret_request(api_key,"/api/settings/secrets",1024*1024)
        try: items=json.loads(raw.decode("utf-8")).get("secrets",[])
        except (UnicodeError,ValueError,AttributeError): raise SecretMaterializationError("invalid secret list",502,"invalid_secret_response")
        if not isinstance(items,list): raise SecretMaterializationError("invalid secret list",502,"invalid_secret_response")
        names=[]
        for item in items:
            name=item.get("name") if isinstance(item,dict) else None
            if isinstance(name,str) and SECRET_NAME_RE.fullmatch(name) and name.endswith(suffix): names.append(name)
        if len(names)>128: raise SecretMaterializationError("too many project secrets",422,"too_many_project_secrets")
        values={}
        for name in sorted(set(names)):
            key=name[:-len(suffix)]
            if not ENV_KEY_RE.fullmatch(key) or key=="APP_BASE_PATH" or key.startswith("WEBGEN_") or key in {"PATH","HOME","COMPOSE_PARALLEL_LIMIT"}: raise SecretMaterializationError("invalid project secret name")
            try: value=self._secret_request(api_key,"/api/settings/secrets/"+quote(name,safe=""),65536).decode("utf-8")
            except UnicodeError: raise SecretMaterializationError("invalid secret encoding")
            values[key]=value
        return values
    def _write_project_env(self,p,lines):
        target=p/".env"
        if target.is_symlink(): raise SecretMaterializationError("invalid environment path")
        owner=p.stat(); tmp=target.with_name(".env.tmp-"+secrets.token_hex(8))
        try:
            with open(tmp,"w",encoding="utf-8",newline="\n") as output:
                output.write("\n".join(lines)+"\n"); output.flush(); os.fsync(output.fileno())
            os.chown(tmp,owner.st_uid,owner.st_gid); os.chmod(tmp,0o600); os.replace(tmp,target)
        finally: tmp.unlink(missing_ok=True)
    def materialize_env(self,slug,p,api_key,base_path):
        _,source,app,env_files=self._source_compose(p)
        env_keys=self.project_env_keys(p,source,app,env_files)
        values=self._project_secret_values(slug,api_key)
        required={key for key in env_keys if self._secret_environment_key(key)}
        metadata=self.metadata(p)
        auth=metadata.get("authProvider",metadata.get("auth_provider"))
        if auth=="better-auth" or metadata.get("needsDatabase") is True or metadata.get("needs_database") is True: required.add("DATABASE_URL")
        if auth=="better-auth": required.add("BETTER_AUTH_SECRET")
        missing=required-set(values)
        if missing: raise SecretMaterializationError("required project secrets are missing")
        lines=[]; example=p/".env.example"
        if example.exists():
            for line in self._local_project_path(p,".env.example").read_text(encoding="utf-8").splitlines():
                match=ENV_LINE_RE.match(line)
                if not match: continue
                key=match.group(1)
                if key=="APP_BASE_PATH" or self._secret_environment_key(key) or key in values: continue
                lines.append(line.strip())
        for key,value in sorted(values.items()): lines.append(key+"="+self._dotenv_quote(value))
        lines.append("APP_BASE_PATH="+self._dotenv_quote(base_path))
        self._write_project_env(p,lines)
    def app_target(self,slug):
        try:
            r=subprocess.run(["docker","inspect","--format","{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",slug+"-app"],capture_output=True,text=True,timeout=3,check=False); ip=r.stdout.strip().splitlines()[-1] if r.returncode==0 else ""
            return f"http://{ip}:3000/api/dck/owner-seed" if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}",ip) else None
        except (OSError,subprocess.TimeoutExpired): return None
    def owner_state(self,slug):
        u=self.app_target(slug)
        if not u:return "unreachable"
        try:
            with urlopen(Request(u),timeout=3) as r:return json.loads(r.read(8192)).get("state")
        except Exception:return "unreachable"
    def deliver_seed(self,slug,p,conversation):
        r,e,u,pw=self.seed.peek(slug,conversation); issued=int(time.time()); expires=issued+120; signed=canonical_signed_payload(1,slug,conversation,issued,expires,r.nonce,e,u,pw); sig=self.seed.private_for(slug).sign(signed); body=json.dumps({"version":1,"project_slug":slug,"conversation_id":conversation,"issued_at":issued,"expires_at":expires,"nonce":r.nonce,"email":e,"username":u,"password":pw,"signature":base64.b64encode(sig).decode()},ensure_ascii=False,separators=(",",":")).encode(); target=self.app_target(slug)
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
            return (f"location /preview/{slug}/ {{\n"
                    f" proxy_pass http://127.0.0.1:{port}/;\n"
                    " proxy_http_version 1.1;\n"
                    " proxy_set_header Host $host;\n"
                    " proxy_set_header X-Real-IP $remote_addr;\n"
                    " proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
                    " proxy_set_header X-Forwarded-Proto $scheme;\n"
                    " proxy_set_header Upgrade $http_upgrade;\n"
                    " proxy_set_header Connection \"upgrade\";\n}\n")
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
    def _health(self,slug,port,path="/"):
        try:
            r=subprocess.run(["docker","inspect","--format","{{.State.Status}}" ,slug+"-app"],capture_output=True,text=True,timeout=3,check=False)
            if r.returncode or r.stdout.strip().lower()!="running": return False
            with socket.create_connection(("127.0.0.1",port),timeout=3) as s:
                request=("GET "+path+" HTTP/1.0\r\nHost: localhost\r\n\r\n").encode("ascii"); s.sendall(request); line=s.recv(64).splitlines()[0].decode("ascii","ignore")
            mm=re.match(r"HTTP/\d(?:\.\d)?\s+(\d{3})",line); return bool(mm and 200<=int(mm.group(1))<400)
        except Exception:return False
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
        with self.lock_for(slug):
            m=self.metadata(p); port=self.port(m)
            if action in {"publish","unpublish"}:
                current=self._published_label(m)
                sub=body.get("subdomain") or slug if action=="publish" else None
                if action=="publish" and not valid_subdomain(sub): raise ValueError("invalid subdomain")
                if action=="unpublish" and not current: raise ValueError("project is not published")
                if action=="publish":
                    self._ensure_unique_subdomain(slug,sub)
                    if m.get("authProvider",m.get("auth_provider"))=="better-auth" and self.owner_state(slug)!="owner_exists": raise RuntimeError("owner authorization required")
                oldenv=(p/".env").read_bytes() if (p/".env").is_file() and not (p/".env").is_symlink() else None
                oldmeta=(p/".dck.json").read_bytes(); oldroutes=self._snapshot_routes(slug); old_base="" if current else f"/preview/{slug}"; runtime_changed=False
                try:
                    self.materialize_env(slug,p,session_api_key,"" if action=="publish" else f"/preview/{slug}")
                    r=self.compose(slug,p,"rebuild")
                    if r.returncode: raise RuntimeError("rebuild failed")
                    runtime_changed=True
                    path="/" if action=="publish" else f"/preview/{slug}/"
                    if not self._health(slug,port,path): raise RuntimeError("application health check failed")
                    self._set_route(slug,p,m,sub if action=="publish" else None)
                    self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso())
                except SecretMaterializationError: raise
                except Exception:
                    self._restore_routes(oldroutes)
                    if oldenv is None: (p/".env").unlink(missing_ok=True)
                    else: self._atomic_bytes(p/".env",oldenv,0o600)
                    self._atomic_bytes(p/".dck.json",oldmeta,0o644)
                    restored=not runtime_changed
                    if runtime_changed:
                        try:
                            rollback=self.compose(slug,p,"rebuild")
                            restored=rollback.returncode==0 and self._health(slug,port,old_base+"/" if old_base else "/")
                        except Exception: restored=False
                    if restored:
                        try:self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso())
                        except Exception:pass
                    else:
                        try:self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso())
                        except Exception:pass
                    try:self.nginx_reload()
                    except Exception:pass
                    raise RuntimeError("publication failed")
                return self.project(slug,p)
            if action in {"deploy","rebuild","start","restart"} and m.get("authProvider",m.get("auth_provider"))=="better-auth":
                if not valid_conversation(conv): raise ValueError("conversation_id required")
                state=self.owner_state(slug)
                if state not in {"owner_exists"} and not self.seed.authorized(slug,conv): raise RuntimeError("owner authorization required")
            if action=="delete": return self._delete(slug,p)
            if action=="stop":
                r=self.compose(slug,p,action)
                if r.returncode: self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("compose operation failed")
                self.update_meta(p,lastStatus="stopped",lastCheckedAt=now_iso()); return self.project(slug,p)
            current=self._published_label(m)
            requested=body.get("subdomain") if action=="deploy" else None
            if requested is not None and not valid_subdomain(requested): raise ValueError("invalid subdomain")
            target=requested or current
            if requested and requested!=current: self._ensure_unique_subdomain(slug,requested)
            base="" if target else f"/preview/{slug}"
            self.materialize_env(slug,p,session_api_key,base)
            r=self.compose(slug,p,action)
            if r.returncode: self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("compose operation failed")
            if not self._health(slug,port,base+"/" if base else "/"): self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("application health check failed")
            routes=self._snapshot_routes(slug); oldmeta=(p/".dck.json").read_bytes()
            try:
                self._set_route(slug,p,m,target)
            except Exception:
                self._restore_routes(routes); self._atomic_bytes(p/".dck.json",oldmeta,0o644)
                try:self.nginx_reload()
                except Exception:pass
                self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("route update failed")
            if m.get("authProvider",m.get("auth_provider"))=="better-auth" and self.owner_state(slug)!="owner_exists" and not self.deliver_seed(slug,p,conv): self.update_meta(p,lastStatus="error",lastCheckedAt=now_iso()); raise RuntimeError("owner seed delivery failed")
            self.update_meta(p,lastStatus="running",lastCheckedAt=now_iso()); return self.project(slug,p)
    def _delete(self,slug,p):
        old=self._snapshot_routes(slug); was_running=self.project(slug,p).get("status")=="running"
        try:
            for f in old: f.unlink(missing_ok=True)
            self.nginx_reload()
            down=self.compose(slug,p,"delete")
            if down.returncode: raise RuntimeError("container cleanup failed")
            db=subprocess.run(["docker","exec","dck-agentic-postgres","psql","-U","dck","-d","dck","-v","ON_ERROR_STOP=1","-c",f'DROP DATABASE IF EXISTS "dck_{slug}" WITH (FORCE)'],capture_output=True,text=True,timeout=30,check=False)
            if db.returncode: raise RuntimeError("database cleanup failed")
            shutil.rmtree(p); return {"slug":slug,"path":f"/projects/webgen/{slug}","name":None,"port":None,"stack":None,"auth_provider":None,"preview_path":None,"subdomain":None,"status":"stopped","last_checked_at":now_iso(),"containers":[]}
        except Exception:
            self._restore_routes(old)
            if was_running and p.exists():
                try:self.compose(slug,p,"deploy")
                except Exception:pass
            try:self.nginx_reload()
            except Exception:pass
            raise RuntimeError("delete failed")
class Handler(BaseHTTPRequestHandler):
    server_version="webgen-control/1"
    def log_message(self,*a): pass
    @property
    def svc(self): return self.server.service
    def send(self,c,o):
        b=json.dumps(o,ensure_ascii=False,separators=(",",":")).encode(); self.send_response(c); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def auth(self):
        key=self.headers.get("X-Session-API-Key")
        if not isinstance(key,str) or not key:return self.send(401,{"error":"unauthorized"}) or False
        try:
            with urlopen(Request(self.svc.canvas,headers={"X-Session-API-Key":key}),timeout=3) as r:r.read(1024); return True
        except HTTPError as e:self.send(e.code if e.code==401 else 503,{"error":"unauthorized" if e.code==401 else "auth_unavailable"}); return False
        except Exception:self.send(503,{"error":"auth_unavailable"}); return False
    def body(self):
        if self.headers.get_content_type()!="application/json": raise ValueError("json required")
        raw=self.headers.get("Content-Length")
        if not raw or not raw.isdigit() or int(raw)>MAX_BODY: raise ValueError("body too large")
        d=json.loads(self.rfile.read(int(raw)))
        if not isinstance(d,dict): raise ValueError("object required")
        return d
    def do_GET(self):
        if self.path=="/healthz": return self.send(200,{"status":"ok"})
        if self.path=="/api/webgen/projects":
            if not self.auth(): return
            return self.send(200,{"projects":self.svc.projects()})
        self.send(404,{"error":"not_found"})
    def do_POST(self):
        if not self.auth():return
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
            self.send(404,{"error":"not_found"})
        except SecretMaterializationError as e:self.send(e.status,{"error":e.code})
        except (ValueError,KeyError,json.JSONDecodeError):self.send(400,{"error":"invalid_request"})
        except OverflowError:self.send(429,{"error":"capacity"})
        except RuntimeError as e:self.send(410 if "authorization" in str(e) else 500,{"error":"owner_authorization_required" if "authorization" in str(e) else "operation_failed"})
        except Exception:self.send(500,{"error":"operation_failed"})
def main():
    host=os.getenv("WEBGEN_BIND_HOST","172.17.0.1"); import ipaddress
    try:
        ip=ipaddress.ip_address(host)
        if not ip.is_private or ip.is_unspecified: raise RuntimeError("refusing public bind")
    except ValueError: raise RuntimeError("invalid bind address")
    s=ThreadingHTTPServer((host,int(os.getenv("WEBGEN_CONTROL_PORT","8769"))),Handler); s.service=Service(); s.serve_forever()
if __name__=="__main__": main()
