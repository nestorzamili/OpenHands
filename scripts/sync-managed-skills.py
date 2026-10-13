import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync(source, target, manifest, conflicts):
    source, target, manifest, conflicts = map(Path, (source, target, manifest, conflicts))
    if target.is_symlink() or manifest.is_symlink() or conflicts.is_symlink():
        raise ValueError("Managed skill paths must not be symlinks")
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    current = {}

    def destination(root, relative):
        path = root / relative
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid managed skill path")
        for parent in (path, *path.parents):
            if parent.is_symlink():
                raise ValueError("Managed skill path contains a symlink")
            if parent == root:
                break
        return path

    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=path.name + ".deploy-", dir=path.parent)
        temp = Path(name)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temp, 0o644)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)

    for entry in sorted(source.rglob("*")):
        if entry.is_symlink():
            raise ValueError("Shipped skills must not contain symlinks")
        if not entry.is_file():
            continue
        relative = entry.relative_to(source)
        key = relative.as_posix()
        dest = destination(target, relative)
        shipped = digest(entry)
        if not dest.exists() or (dest.is_file() and digest(dest) == previous.get(key)):
            write(dest, entry.read_bytes())
            current[key] = shipped
        else:
            if key in previous:
                current[key] = previous[key]
            if not dest.is_file() or digest(dest) != shipped:
                write(destination(conflicts, relative), entry.read_bytes())
                print(f"Preserved local skill; update candidate: {relative.as_posix()}")
    for key, old_hash in previous.items():
        if (source / key).exists():
            continue
        dest = destination(target, Path(key))
        if dest.is_file() and digest(dest) == old_hash:
            dest.unlink()
    write(manifest, (json.dumps(current, indent=2) + "\n").encode())


if __name__ == "__main__":
    sync(*sys.argv[1:])
