import unittest

from automation.scripts.file_transfer import Endpoint


class EndpointTest(unittest.TestCase):
    def test_rsync_value_quotes_remote_shell_metacharacters(self):
        endpoint = Endpoint("example-host", "/reports/profile_iter(38-42)_n0.nsys-rep")

        self.assertEqual(
            endpoint.rsync_value(),
            "example-host:'/reports/profile_iter(38-42)_n0.nsys-rep'",
        )

    def test_rsync_value_leaves_local_path_unchanged(self):
        endpoint = Endpoint(None, "/local/profile_iter(38-42)_n0.nsys-rep")

        self.assertEqual(endpoint.rsync_value(), "/local/profile_iter(38-42)_n0.nsys-rep")


if __name__ == "__main__":
    unittest.main()
