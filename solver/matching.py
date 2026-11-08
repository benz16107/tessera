"""Photo loading, EXIF, and the MegaLoc / SuperPoint / LightGlue models (through hloc), shared by build and solve."""
from pathlib import Path

import numpy as np
import torch
from hloc import extract_features, extractors, match_features, matchers
from hloc.extract_features import ImageDataset
from hloc.utils.base_model import dynamic_load
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

# MegaLoc at 448 px: 1024 px took 7 s per image on this CPU
GLOBAL_CONF = {**extract_features.confs['megaloc'], 'output': 'global', 'preprocessing': {'resize_max': 448}}
LOCAL_CONF = {**extract_features.confs['superpoint_aachen'], 'output': 'local'}
LOCAL_CONF['model'] = {**LOCAL_CONF['model'], 'max_keypoints': 2048}
MATCH_CONF = match_features.confs['superpoint+lightglue']
MAX_SIDE = 1600
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.heic', '.heif'}


def _ratio(v):
    return float(v[0]) / float(v[1]) if isinstance(v, tuple) else float(v)


def read_exif(path):
    """lat, lon, heading (+ref), f35 with digital zoom applied, from a photo's own EXIF. Missing values are None."""
    out = dict(lat=None, lon=None, heading=None, heading_ref=None, f35=None, zoom=None)
    try:
        exif = Image.open(path).getexif()
    except OSError:
        return out
    gps, ex = exif.get_ifd(0x8825), exif.get_ifd(0x8769)
    try:
        if 2 in gps and 4 in gps:
            lat = sum(_ratio(x) / 60 ** i for i, x in enumerate(gps[2]))
            lon = sum(_ratio(x) / 60 ** i for i, x in enumerate(gps[4]))
            out['lat'] = -lat if gps.get(1) == 'S' else lat
            out['lon'] = -lon if gps.get(3) == 'W' else lon
        if 17 in gps:
            out['heading'], out['heading_ref'] = _ratio(gps[17]), gps.get(16, 'T')
        if ex.get(41989):
            out['zoom'] = _ratio(ex[41988]) if ex.get(41988) else None
            out['f35'] = float(ex[41989])
    except (TypeError, ZeroDivisionError, ValueError):
        pass
    return out


def exif_f35(meta):
    """EXIF 35 mm focal times the digital zoom ratio: a 2.27x zoomed iPhone shot reads 33 mm but frames like 75 mm."""
    if not meta.get('f35'):
        return None
    return meta['f35'] * (meta.get('zoom') or 1.0)


def normalize(src, dst):
    """Upright RGB JPEG, long side at most MAX_SIDE. hloc ignores EXIF orientation, so every image goes through this.
    Returns the upright size of the source."""
    im = ImageOps.exif_transpose(Image.open(src))
    size = im.size
    im = im.convert('RGB')
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=93)
    return size


class Models:
    """MegaLoc, SuperPoint and LightGlue, loaded once."""

    def __init__(self):
        self.glob = dynamic_load(extractors, GLOBAL_CONF['model']['name'])(GLOBAL_CONF['model']).eval()
        self.local = dynamic_load(extractors, LOCAL_CONF['model']['name'])(LOCAL_CONF['model']).eval()
        self.matcher = dynamic_load(matchers, MATCH_CONF['model']['name'])(MATCH_CONF['model']).eval()

    @torch.no_grad()  # grad mode is per thread, and the server solves on worker threads
    def features(self, path):
        """Same preprocessing and keypoint scaling as hloc's extract_features, so queries match the stored database."""
        path = Path(path)
        g = ImageDataset(path.parent, GLOBAL_CONF['preprocessing'], [path.name])[0]
        desc = self.glob({'image': torch.from_numpy(g['image'])[None]})['global_descriptor'][0].numpy()
        d = ImageDataset(path.parent, LOCAL_CONF['preprocessing'], [path.name])[0]
        p = self.local({'image': torch.from_numpy(d['image'])[None]})
        size = d['original_size']
        scale = size / np.array(d['image'].shape[-2:][::-1])
        kp = (p['keypoints'][0].numpy() + 0.5) * scale - 0.5
        return desc.astype(np.float32), dict(keypoints=kp.astype(np.float32), descriptors=p['descriptors'][0], size=size)

    @torch.no_grad()
    def match(self, a, b):
        """LightGlue matches between two local feature sets, as an (n, 2) array of keypoint indices."""
        data = {}
        for i, f in (('0', a), ('1', b)):
            data['image' + i] = torch.empty((1, 1) + tuple(int(v) for v in f['size'][::-1]))
            data['keypoints' + i] = torch.as_tensor(f['keypoints'], dtype=torch.float32)[None]
            data['descriptors' + i] = torch.as_tensor(f['descriptors'], dtype=torch.float32)[None]
        m = self.matcher(data)['matches0'][0].numpy()
        ok = m > -1
        return np.stack([np.where(ok)[0], m[ok]], 1)
