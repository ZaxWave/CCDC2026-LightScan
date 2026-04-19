"""
tools/merge_datasets.py

将 RDD2022（VOC XML）+ SVRDD（YOLO 7类）合并为统一的 4 类 YOLO 数据集。
多余的 SVRDD 类别（Patch、Manhole Cover）自动忽略。

输出：
    datasets/merged/
    ├── images/train/   (~26,000 张)
    ├── images/val/     (~7,000 张)
    ├── labels/train/
    ├── labels/val/
    └── data.yaml

用法：
    python tools/merge_datasets.py --dry-run    # 预检，不写文件
    python tools/merge_datasets.py              # 正式合并
"""

import argparse
import random
import shutil
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from tqdm import tqdm

# ── 路径 ──────────────────────────────────────────────────────────────────────
ROOT     = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets"
OUT_DIR  = DATASETS / "merged"

# ── RDD2022：VOC XML → 4 类 ───────────────────────────────────────────────────
RDD_SUBSETS = ["Japan", "China_MotorBike"]

RDD_LABEL_MAP = {
    "D00": 0,   # 纵向裂缝
    "D10": 1,   # 横向裂缝
    "D20": 2,   # 龟裂
    "D40": 3,   # 坑槽
}

# ── SVRDD：7 类 → 4 类（None = 丢弃）─────────────────────────────────────────
SVRDD_DIR = DATASETS / "SVRDD.v1i.yolov11"

SVRDD_REMAP = {
    0: 2,    # Alligator Crack    → D20 龟裂
    1: 0,    # Longitudinal Crack → D00 纵向裂缝
    2: None, # Longitudinal Patch → 忽略
    3: None, # Manhole Cover      → 忽略
    4: 3,    # Pothole            → D40 坑槽
    5: 1,    # Transverse Crack   → D10 横向裂缝
    6: None, # Transverse Patch   → 忽略
}

# ── 输出类别 ───────────────────────────────────────────────────────────────────
CLASS_NAMES = ["D00", "D10", "D20", "D40"]
VAL_RATIO   = 0.2
RANDOM_SEED = 42


# ── RDD2022 解析 ───────────────────────────────────────────────────────────────
def parse_rdd_xml(xml_path: Path) -> list[tuple]:
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    W = int(size.findtext("width"))
    H = int(size.findtext("height"))
    boxes = []
    for obj in root.findall("object"):
        name = obj.findtext("name")
        if name not in RDD_LABEL_MAP:
            continue
        bnd  = obj.find("bndbox")
        xmin = max(0.0, min(float(bnd.findtext("xmin")), W))
        ymin = max(0.0, min(float(bnd.findtext("ymin")), H))
        xmax = max(0.0, min(float(bnd.findtext("xmax")), W))
        ymax = max(0.0, min(float(bnd.findtext("ymax")), H))
        if xmax <= xmin or ymax <= ymin:
            continue
        boxes.append((
            RDD_LABEL_MAP[name],
            (xmin + xmax) / 2 / W,
            (ymin + ymax) / 2 / H,
            (xmax - xmin) / W,
            (ymax - ymin) / H,
        ))
    return boxes


def collect_rdd() -> list[tuple]:
    """返回 [(prefix_stem, img_path, boxes), ...]"""
    samples = []
    for subset in RDD_SUBSETS:
        xml_dir = DATASETS / subset / "train" / "annotations" / "xmls"
        img_dir = DATASETS / subset / "train" / "images"
        if not xml_dir.exists():
            print(f"  [跳过] {xml_dir} 不存在")
            continue
        for xml in tqdm(sorted(xml_dir.glob("*.xml")), desc=f"RDD {subset}", unit="xml"):
            img = img_dir / xml.with_suffix(".jpg").name
            if not img.exists():
                continue
            boxes = parse_rdd_xml(xml)
            samples.append((f"rdd_{subset}_{xml.stem}", img, boxes))
    return samples


# ── SVRDD 解析 ────────────────────────────────────────────────────────────────
def remap_svrdd_label(txt_path: Path) -> list[tuple]:
    boxes = []
    for line in txt_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        old_cls = int(parts[0])
        new_cls = SVRDD_REMAP.get(old_cls)
        if new_cls is None:
            continue
        boxes.append((new_cls, float(parts[1]), float(parts[2]),
                       float(parts[3]), float(parts[4])))
    return boxes


def collect_svrdd() -> list[tuple]:
    """返回 [(prefix_stem, img_path, boxes), ...]"""
    samples = []
    for split in ("train", "valid"):
        img_dir = SVRDD_DIR / split / "images"
        lbl_dir = SVRDD_DIR / split / "labels"
        if not img_dir.exists():
            continue
        for img in tqdm(sorted(img_dir.glob("*.jpg")), desc=f"SVRDD {split}", unit="img"):
            lbl = lbl_dir / img.with_suffix(".txt").name
            if not lbl.exists():
                continue
            boxes = remap_svrdd_label(lbl)
            samples.append((f"svrdd_{img.stem}", img, boxes))
    return samples


# ── 写出文件 ───────────────────────────────────────────────────────────────────
def write_sample(stem: str, img_path: Path, boxes: list, split: str) -> None:
    shutil.copy2(img_path, OUT_DIR / "images" / split / f"{stem}.jpg")
    lbl = OUT_DIR / "labels" / split / f"{stem}.txt"
    with lbl.open("w") as f:
        for cls_id, x_c, y_c, bw, bh in boxes:
            f.write(f"{cls_id} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}\n")


def write_yaml(n_train: int, n_val: int) -> None:
    data_yaml = OUT_DIR / "data.yaml"
    data_yaml.write_text(
        f"# LightScan 合并数据集  train={n_train}  val={n_val}\n"
        f"path: {OUT_DIR}\n"
        f"train: images/train\n"
        f"val:   images/val\n\n"
        f"nc: {len(CLASS_NAMES)}\n"
        f"names: {CLASS_NAMES}\n"
    )
    print(f"  data.yaml → {data_yaml}")


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写文件")
    args = parser.parse_args()
    t0 = time.time()

    print("=== 收集样本 ===")
    samples = collect_rdd() + collect_svrdd()

    # 统计
    cls_count: dict[int, int] = defaultdict(int)
    for _, _, boxes in samples:
        for cls_id, *_ in boxes:
            cls_count[cls_id] += 1

    n_val = int(len(samples) * VAL_RATIO)
    print(f"\n{'='*50}")
    print(f"  总样本数:     {len(samples)}")
    print(f"  预计 train:   {len(samples) - n_val}")
    print(f"  预计 val:     {n_val}")
    print(f"  各类别标注数:")
    for cid, name in enumerate(CLASS_NAMES):
        print(f"    [{cid}] {name}: {cls_count[cid]}")
    print(f"{'='*50}")

    if args.dry_run:
        print("\n[dry-run] 未写任何文件。确认无误后去掉 --dry-run 正式运行。\n")
        return

    # 建目录
    for split in ("train", "val"):
        (OUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    # 打乱 + 划分
    rng = random.Random(RANDOM_SEED)
    rng.shuffle(samples)
    val_set = set(range(len(samples) - n_val, len(samples)))

    n_train = n_val_out = 0
    for idx, (stem, img_path, boxes) in enumerate(
        tqdm(samples, desc="写出文件", unit="img")
    ):
        split = "val" if idx in val_set else "train"
        write_sample(stem, img_path, boxes, split)
        if split == "val":
            n_val_out += 1
        else:
            n_train += 1

    write_yaml(n_train, n_val_out)

    elapsed = time.time() - t0
    print(f"\n完成！耗时 {elapsed/60:.1f} 分钟")
    print(f"  train: {n_train} 张   val: {n_val_out} 张")
    print(f"  输出: {OUT_DIR}\n")


if __name__ == "__main__":
    main()
