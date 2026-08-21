# 🐳 คู่มือการรัน ClipToManual บน Docker (เครื่องบ้าน AIS 192.168.1.202) + Tailscale

> **เป้าหมาย:** สั่งรันโปรแกรม `clip-to-manual` บนเครื่องเซิร์ฟเวอร์ที่บ้าน (AIS Fibre `192.168.1.202`) ผ่าน Docker และเชื่อมต่อเข้ามาใช้งานจากคอมพิวเตอร์ที่ทำงานได้อย่างปลอดภัย 100% ผ่าน Tailscale

---

## 🏗️ สถาปัตยกรรมการเชื่อมต่อ (Architecture Overview)

```text
🏢 คอมพิวเตอร์ที่ทำงาน
   │
   ▼ (เข้ารหัส End-to-End ผ่าน Tailscale)
   │
   ▼ (ทะลุ AIS Fibre CGNAT / Firewall อัตโนมัติ)
   │
🏠 เครื่องบ้าน AIS (192.168.1.202 / Tailscale IP: 100.x.x.x)
   └── 🐳 Docker Container: clip-to-manual (Port 3100)
       ├── Node.js 22 + TypeScript Engine
       ├── yt-dlp + ffmpeg (ดึงคลิปและซับไตเติลภาษาไทย)
       └── โฟลเดอร์จัดเก็บคู่มือ: ./manuals/ (Persisted บน Host)
```

---

## 🚀 ขั้นตอนที่ 1: ติดตั้งและรันบนเครื่อง Docker ที่บ้าน (`192.168.1.202`)

1. **เปิด Terminal / SSH เข้าไปที่เครื่องบ้าน (`192.168.1.202`):**
   ```bash
   # Clone โค้ดจาก GitHub ลงมาที่เครื่องบ้าน
   git clone https://github.com/thanonhari/clip-to-manual.git
   cd clip-to-manual
   ```

2. **สร้างไฟล์ `.env` (ถ้าต้องการใส่ Gemini API Key):**
   ```bash
   cp .env.example .env
   # แก้ไขใส่ GEMINI_API_KEY=AIzaSy... (ถ้ามี)
   ```

3. **สั่งรัน Container ด้วย Docker Compose (1 คำสั่ง):**
   ```bash
   docker compose up -d --build
   ```

4. **ตรวจสอบสถานะการทำงาน:**
   ```bash
   docker compose ps
   # จะแสดงสถานะ clip-to-manual กำลังรันอยู่ที่ port 3100
   ```
   *(คุณสามารถทดสอบเปิดจากในบ้านได้ที่: `http://192.168.1.202:3100`)*

---

## 🔒 ขั้นตอนที่ 2: ติดตั้ง Tailscale เพื่อให้ที่ทำงานเข้าถึงได้

### วิธีที่ง่ายที่สุด (แนะนำ): ติดตั้ง Tailscale บนเครื่อง Host ที่บ้าน
1. ติดตั้ง Tailscale บนเครื่องบ้าน (`192.168.1.202`):
   - **ถ้าเป็น Linux / Ubuntu:**
     ```bash
     curl -fsSL https://tailscale.com/install.sh | sh
     sudo tailscale up
     ```
   - **ถ้าเป็น Windows / Synology:** ดาวน์โหลดแอป [Tailscale](https://tailscale.com/download) แล้วกดล็อกอินด้วย Google / GitHub
2. เครื่องบ้านของคุณจะได้รับ **Tailscale IP** ทันที (เช่น `100.80.20.10`)

---

## 🏢 ขั้นตอนที่ 3: เปิดใช้งานจากคอมพิวเตอร์ที่ทำงาน

1. **บนเครื่องที่ทำงาน:**
   - ติดตั้ง Tailscale และล็อกอินด้วยบัญชี Google หรือ GitHub เดียวกันกับเครื่องที่บ้าน
2. **เปิดใช้งาน:**
   - เปิดเบราว์เซอร์ที่ทำงานแล้วพิมพ์:  
     👉 **`http://100.80.20.10:3100`** *(แทนที่ด้วย Tailscale IP ของเครื่องบ้าน)*
3. **ผลลัพธ์:**
   - หน้า Dashboard Studio ของ `clip-to-manual` จะเปิดขึ้นมาทันที!
   - คุณสามารถสั่งดึงคลิป, สร้างคู่มือ, และอ่านคลังคู่มือได้เหมือนนั่งทำงานอยู่หน้าเครื่องที่บ้าน
   - ไฟล์คู่มือทั้งหมดจะถูกบันทึกลงในโฟลเดอร์ `manuals/` บนเครื่องบ้านอย่างปลอดภัย!

---

## 🛠️ คำสั่งที่ใช้บ่อยบน Docker (Useful Docker Commands)

```bash
# ดู Log การทำงานของระบบ
docker compose logs -f

# หยุดการทำงานของระบบ
docker compose down

# อัปเดตโค้ดเวอร์ชันล่าสุดจาก GitHub และ Rebuild
git pull origin main
docker compose up -d --build
```
