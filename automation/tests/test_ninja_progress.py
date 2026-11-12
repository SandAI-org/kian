import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ninja_progress import compile_outputs, finished_outputs, parent_step


class NinjaProgressTests(unittest.TestCase):
    def test_only_compile_edges_are_counted(self):
        text = 'build a.o: compile a.cpp\nbuild b.o: cuda_compile b.cu\nbuild lib.so: link a.o b.o\nbuild all: phony lib.so\n'
        self.assertEqual(compile_outputs(text), {'a.o', 'b.o'})

    def test_log_deduplicates_and_ignores_unrelated_outputs(self):
        text = '# ninja log v5\n0\t1\t2\ta.o\t123\n0\t2\t3\ta.o\t456\n0\t2\t3\told.o\t789\npartial'
        self.assertEqual(finished_outputs(text, {'a.o', 'b.o'}), {'a.o'})

    def test_escaped_paths(self):
        text = 'build some$ file.o: cuda_compile x.cu\nbuild drive$:file.o: compile x.cpp\n'
        expected = {'some file.o', 'drive:file.o'}
        self.assertEqual(compile_outputs(text), expected)
        self.assertEqual(finished_outputs('0\t1\t2\tsome file.o\thash', expected), {'some file.o'})

    def test_parent_phase_detection(self):
        self.assertEqual(parent_step('[stage-0 18/22] RUN build'), 18)
        self.assertIsNone(parent_step('[internal] load context'))


if __name__ == '__main__':
    unittest.main()
