import io
import math
import os
import random
from datetime import datetime

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

_FALLBACK_LAT = float(os.getenv("GPS_FALLBACK_LAT", "30.474"))
_FALLBACK_LNG = float(os.getenv("GPS_FALLBACK_LNG", "114.414"))
_SPREAD = 0.045

# ── WGS-84 → GCJ-02（国测局坐标，高德/腾讯地图使用） ─────────────────────────
_A  = 6378245.0
_EE = 0.00669342162296594323


def _out_of_china(lat: float, lng: float) -> bool:
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
    ret += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2.0/3.0
    ret += (20.0*math.sin(y*math.pi) + 40.0*math.sin(y/3.0*math.pi)) * 2.0/3.0
    ret += (160.0*math.sin(y/12.0*math.pi) + 320*math.sin(y*math.pi/30.0)) * 2.0/3.0
    return ret


def _transform_lng(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    ret += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2.0/3.0
    ret += (20.0*math.sin(x*math.pi) + 40.0*math.sin(x/3.0*math.pi)) * 2.0/3.0
    ret += (150.0*math.sin(x/12.0*math.pi) + 300.0*math.sin(x/30.0*math.pi)) * 2.0/3.0
    return ret


def wgs84_to_gcj02(lat: float, lng: float) -> tuple[float, float]:
    """将 WGS-84 坐标转换为 GCJ-02（高德/腾讯地图标准）。境外坐标原样返回。"""
    if _out_of_china(lat, lng):
        return lat, lng
    d_lat = _transform_lat(lng - 105.0, lat - 35.0)
    d_lng = _transform_lng(lng - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = (d_lat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    d_lng = (d_lng * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * math.pi)
    return round(lat + d_lat, 6), round(lng + d_lng, 6)


# ── EXIF GPS 解析 ─────────────────────────────────────────────────────────────

def _get_decimal_from_dms(dms, ref):
    degrees = dms[0]
    minutes = dms[1] / 60.0
    seconds = dms[2] / 3600.0
    val = round(degrees + minutes + seconds, 6)
    if ref in ('S', 'W'):
        val = -val
    return val


_GPS_IFD_TAG = 0x8825  # ExifTags.Base.GPSInfo


def _parse_exif_gps(img_bytes: bytes) -> tuple[float, float] | None:
    """从 EXIF 提取 WGS-84 GPS 并转换为 GCJ-02，失败返回 None。

    Pillow 8+ 推荐用 get_ifd(0x8825) 读 GPS 子 IFD，比遍历 items() 更可靠。
    """
    try:
        image = Image.open(io.BytesIO(img_bytes))
        exif = image.getexif()
        if not exif:
            return None

        # 优先使用 get_ifd（Pillow 8+），回退到遍历兼容旧版本
        gps_ifd = exif.get_ifd(_GPS_IFD_TAG)
        if not gps_ifd:
            # 旧版 Pillow 兼容路径
            for tag, value in exif.items():
                if TAGS.get(tag) == "GPSInfo":
                    gps_ifd = {GPSTAGS.get(t, t): value[t] for t in value}
                    break

        if not gps_ifd:
            return None

        # get_ifd 返回的 key 是整数 tag ID，需要转成名称
        geo_info: dict = {}
        for k, v in gps_ifd.items():
            name = GPSTAGS.get(k, k) if isinstance(k, int) else k
            geo_info[name] = v

        if 'GPSLatitude' not in geo_info or 'GPSLongitude' not in geo_info:
            return None

        lat = _get_decimal_from_dms(geo_info['GPSLatitude'],  geo_info.get('GPSLatitudeRef',  'N'))
        lng = _get_decimal_from_dms(geo_info['GPSLongitude'], geo_info.get('GPSLongitudeRef', 'E'))
        if lat == 0.0 and lng == 0.0:
            return None
        # EXIF GPS 是 WGS-84，转为高德使用的 GCJ-02
        return wgs84_to_gcj02(lat, lng)
    except Exception:
        pass
    return None


def extract_capture_time(img_bytes: bytes) -> datetime | None:
    """从 EXIF 提取拍摄时间（DateTimeOriginal 优先，回退到 DateTime）。返回 naive datetime 或 None。"""
    _FMT = "%Y:%m:%d %H:%M:%S"
    try:
        image = Image.open(io.BytesIO(img_bytes))
        exif = image.getexif()
        if not exif:
            return None
        # DateTimeOriginal(0x9003) 是快门按下的时间，比 DateTime(0x0132) 更准确
        for tag_id in (0x9003, 0x0132):
            val = exif.get(tag_id)
            if val:
                try:
                    return datetime.strptime(str(val).strip(), _FMT)
                except ValueError:
                    continue
    except Exception:
        pass
    return None


def extract_gps_from_image(img_bytes: bytes) -> tuple[float, float]:
    """提取真实 GPS（GCJ-02），若无则在武汉光谷区域生成模拟坐标（inference_service 使用）。"""
    result = _parse_exif_gps(img_bytes)
    if result:
        return result
    mock_lat = round(_FALLBACK_LAT + random.uniform(-_SPREAD, _SPREAD), 6)
    mock_lng = round(_FALLBACK_LNG + random.uniform(-_SPREAD, _SPREAD), 6)
    return mock_lat, mock_lng


def extract_gps_strict(img_bytes: bytes) -> tuple[float | None, float | None]:
    """提取 EXIF GPS（GCJ-02）。无真实坐标时返回 (None, None)（detect 路由使用）。"""
    result = _parse_exif_gps(img_bytes)
    return result if result else (None, None)
