import unittest
from labels import f35_with_zoom, to_bin, split_groups


class T(unittest.TestCase):
    def test_bin_edges(self):
        for v, b in [(10, "ultrawide"), (23.99, "ultrawide"), (24, "wide"), (34.9, "wide"), (35, "normal"),
                     (69.9, "normal"), (70, "tele"), (200, "super-tele"), (199.9, "tele"), (600, "super-tele")]:
            self.assertEqual(to_bin(v), b, v)

    def test_zoom(self):
        self.assertAlmostEqual(f35_with_zoom(33, 2.27), 74.91, 2)
        self.assertEqual(f35_with_zoom(28, 1), 28)      # no zoom
        self.assertEqual(f35_with_zoom(28, 0), 28)      # 0 means "not used" in EXIF
        self.assertEqual(f35_with_zoom(28, None), 28)
        self.assertEqual(f35_with_zoom(115, 3.3, "Apple"), 115)  # Apple's tag already includes the zoom
        self.assertAlmostEqual(f35_with_zoom(25, 2.0, "Google"), 50)
        self.assertIsNone(f35_with_zoom(None, 2))
        self.assertIsNone(f35_with_zoom(0, 2))

    def test_split_disjoint(self):
        counts = {f"site{i}": 30 + i for i in range(40)}
        counts.update({"nyc_dumbo": 90, "cat:Lens focal length 300 mm": 40})
        s = split_groups(counts)
        sets = [set(s[k]) for k in ("train", "val", "test")]
        self.assertFalse(sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2])
        self.assertEqual(set.union(*sets), set(counts))
        self.assertIn("nyc_dumbo", s["test"])
        self.assertEqual(len(s["test"]), 3)
        self.assertNotIn("cat:Lens focal length 300 mm", s["test"] + s["val"])


if __name__ == "__main__":
    unittest.main()
