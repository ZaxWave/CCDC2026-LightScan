import io
import os
import random

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

# 无 EXIF 时的模拟中心点（通过 .env 配置，默认武汉光谷）
_FALLBACK_LAT = float(os.getenv("GPS_FALLBACK_LAT", "30.474"))
_FALLBACK_LNG = float(os.getenv("GPS_FALLBACK_LNG", "114.414"))
# 随机散布半径：±约 5 km，让演示数据在地图上自然分布
_SPREAD = 0.045


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

    # 无 EXIF GPS：在配置中心点附近随机散布，供地图演示
    mock_lat = round(_FALLBACK_LAT + random.uniform(-_SPREAD, _SPREAD), 6)
    mock_lng = round(_FALLBACK_LNG + random.uniform(-_SPREAD, _SPREAD), 6)
    return mock_lat, mock_lng
