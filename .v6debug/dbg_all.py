import sys
sys.path.insert(0, "/tmp/v6")
import numpy as np
from PIL import Image
import verify_v6 as v6

img = v6.gen_test_image()
src = np.asarray(img)
src_bgr = src[:, :, ::-1].copy()

print("=== RAW det on BGR image (current verify_v6 path) ===")
parts_bgr = v6.det(src_bgr, max(src_bgr.shape[:2]))
print("detected blocks:", len(parts_bgr))
for sc, part in parts_bgr:
    print("  BGR part shape:", part.shape, "dtype:", part.dtype)

def run_rec(part, label):
    h0, w0 = part.shape[:2]
    if h0 == 0:
        print(f"  [{label}] h0==0 -> empty")
        return
    dst_h = 48
    scale = dst_h / h0
    dst_w = max(1, int(w0 * scale))
    pil_img = Image.fromarray(part).resize((dst_w, dst_h), Image.BILINEAR)
    arr = np.asarray(pil_img, dtype=np.float32)
    arr = arr / 127.5 - 1.0
    arr = arr.transpose(2, 0, 1)[None]
    out = v6.REC.run(None, {"x": arr.astype(np.float32)})[0]
    preds = out[0]
    argmaxes = np.argmax(preds, axis=1)
    nz = int((argmaxes > 0).sum())
    text = ""
    last = 0
    for step in preds:
        idx = int(np.argmax(step))
        if 0 < idx < len(v6.keys) and last != idx:
            text += v6.keys[idx]
        last = idx
    print(f"  [{label}] part={part.shape} -> resize=({dst_w},{dst_h}) nz={nz}/{len(argmaxes)} text={text!r}")
    print(f"      argmax first60: {argmaxes[:60].tolist()}")

for i, (sc, part) in enumerate(parts_bgr):
    run_rec(part, f"BGR raw block{i}")

print()
print("=== Now try RGB interpretation of the same parts (flip channels) ===")
for i, (sc, part) in enumerate(parts_bgr):
    run_rec(part[:, :, ::-1].copy(), f"RGB flipped block{i}")

print()
print("=== Manual crop from raw RGB image like dbg_rec.py ===")
part_manual = src[30:110, 20:730]
run_rec(part_manual, "manual rgb crop")

print()
print("=== Manual crop BGR ===")
run_rec(part_manual[:, :, ::-1].copy(), "manual bgr crop")

print()
print("=== det on RGB image directly ===")
parts_rgb = v6.det(src.copy(), max(src.shape[:2]))
print("detected blocks:", len(parts_rgb))
for sc, part in parts_rgb:
    run_rec(part, f"RGB det block (part dtype {part.dtype})")