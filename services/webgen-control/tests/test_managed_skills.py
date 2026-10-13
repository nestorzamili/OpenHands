import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("managed_skills", Path(__file__).parents[3] / "scripts/sync-managed-skills.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManagedSkillsTest(unittest.TestCase):
    def test_upgrade_preserves_custom_and_modified_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / "source", root / "target"
            source.mkdir(); target.mkdir()
            (target / "custom.md").write_text("user skill")
            (target / "unknown.md").write_text("legacy edit")
            for name in ("builtin.md", "edited.md", "removed.md", "unknown.md"):
                (source / name).write_text("version one")
            args = (source, target, root / "manifest.json", root / "conflicts")
            module.sync(*args)
            (target / "edited.md").write_text("user edit")
            (source / "builtin.md").write_text("version two")
            (source / "edited.md").write_text("version two")
            (source / "removed.md").unlink()
            module.sync(*args)
            module.sync(*args)
            self.assertEqual((target / "custom.md").read_text(), "user skill")
            self.assertEqual((target / "unknown.md").read_text(), "legacy edit")
            self.assertEqual((target / "edited.md").read_text(), "user edit")
            self.assertEqual((target / "builtin.md").read_text(), "version two")
            self.assertFalse((target / "removed.md").exists())
            self.assertEqual((root / "conflicts/edited.md").read_text(), "version two")


if __name__ == "__main__":
    unittest.main()
