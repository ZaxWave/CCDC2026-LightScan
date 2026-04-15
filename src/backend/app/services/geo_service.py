import io
import random

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS


def _get_decimal_from_dms(dms, ref):
    degrees = dms[0]
    minutes = dms[1] / 60.0
    seconds = dms[2] / 3600.0
    val = round(degrees + minutes + seconds, 6)
    if ref in ('S', 'W'):
        val = -val
    return val


def extract_gps_from_image(img_bytes: bytes) -> tuple[float, float]:
    """提取真实 GPS，若无则在武汉光谷区域生成模拟坐标供地图演示"""
    try:
        image = Image.open(io.BytesIO(img_bytes))
        # Pillow >= 8.0 推荐使用 getexif()；_getexif() 已废弃
        exif = image.getexif()
        if exif:
            geo_info = {}
            for tag, value in exif.items():
                decoded = TAGS.get(tag, tag)
                if decoded == "GPSInfo":
                    for t in value:
                        sub_decoded = GPSTAGS.get(t, t)
                        geo_info[sub_decoded] = value[t]
            if 'GPSLatitude' in geo_info and 'GPSLongitude' in geo_info:
                lat = _get_decimal_from_dms(
                    geo_info['GPSLatitude'], geo_info['GPSLatitudeRef']
                )
                lng = _get_decimal_from_dms(
                    geo_info['GPSLongitude'], geo_info['GPSLongitudeRef']
                )
                return lat, lng
    except Exception:
        pass

    # 模拟坐标（武汉光谷区域）
    mock_lat = round(random.uniform(30.40, 30.55), 6)
    mock_lng = round(random.uniform(114.35, 114.45), 6)
    return mock_lat, mock_lng
