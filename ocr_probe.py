import io, json, os, sys, time
import requests
from PIL import Image, ImageDraw, ImageFont

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
TOKEN = "099689de1f93189ec7bedf02ed3d2b7e32b8594d"
MODEL = "PP-OCRv6"

# Create a test image with text
img = Image.new("RGB", (800, 300), "white")
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("DejaVuSans.ttf", 40)
except Exception:
    font = ImageFont.load_default()
draw.text((30, 40), "Hello OCR Test 123", fill="black", font=font)
draw.text((30, 140), "Hello OCR Test 123", fill="black", font=font)
buf = io.BytesIO()
img.save(buf, format="PNG")
buf.seek(0)
data_bytes = buf.read()
print("image bytes:", len(data_bytes))

headers = {"Authorization": f"bearer {TOKEN}"}
optional_payload = {"useDocOrientationClassify": False, "useDocUnwarping": False, "useTextlineOrientation": False}

files = {"file": ("test.png", data_bytes, "image/png")}
form = {
    "model": MODEL,
    "optionalPayload": json.dumps(optional_payload),
}
r = requests.post(JOB_URL, headers=headers, data=form, files=files, timeout=60)
print("submit status:", r.status_code)
print("submit body:", r.text[:2000])
if r.status_code != 200:
    sys.exit(1)
jobId = r.json()["data"]["jobId"]
print("jobId:", jobId)

jsonl_url = ""
for i in range(60):
    time.sleep(5)
    jr = requests.get(f"{JOB_URL}/{jobId}", headers=headers, timeout=60)
    print("poll status:", jr.status_code)
    state = jr.json()["data"]["state"]
    print("state:", state)
    if state == "done":
        jsonl_url = jr.json()["data"]["resultUrl"]["jsonUrl"]
        break
    elif state == "failed":
        print("failed body:", jr.text[:2000])
        sys.exit(1)

print("jsonl_url:", jsonl_url)
jr2 = requests.get(jsonl_url, timeout=60)
print("jsonl status:", jr2.status_code)
print("jsonl content:")
print(jr2.text[:8000])
