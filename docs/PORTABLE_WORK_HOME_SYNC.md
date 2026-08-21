# 🔄 คู่มือการสลับทำงานระหว่าง "ที่ทำงาน" (Office) และ "ที่บ้าน" (Home) โดยไม่ต้องเริ่มใหม่

> **Project:** ClipToManual  
> **Repository:** `clip-to-manual`  
> **เป้าหมาย:** สลับเครื่องทำงานไป-มา ระหว่างคอมพิวเตอร์ที่ทำงานและที่บ้านได้อย่างต่อเนื่อง 100% ผ่าน GitHub และ Portable Launcher

---

## 🏢 ส่วนที่ 1: ขั้นตอนแรกเมื่อนำไปติดตั้งที่คอมพิวเตอร์ที่ทำงาน (First Install at Office)

เมื่อคุณมาถึงที่ทำงาน และต้องการเปิดใช้งานโปรเจกต์นี้ในเครื่องใหม่:

### วิธีที่ 1: ผ่าน Git Clone (แนะนำที่สุด)
1. เปิด **Terminal** หรือ **PowerShell** ในเครื่องที่ทำงาน
2. รันคำสั่ง Clone โปรเจกต์ลงมา:
   ```bash
   git clone https://github.com/thanonhari/clip-to-manual.git
   cd clip-to-manual
   ```
3. ดับเบิลคลิกไฟล์ **`start.bat`** (หรือพิมพ์ `.\start.bat` ใน PowerShell)
   - ระบบจะตรวจหา Node.js, ติดตั้ง `node_modules` อัตโนมัติ, โหลด `yt-dlp.exe` ให้เอง, เคลียร์ Port 3100 และเปิดเบราว์เซอร์ที่ `http://localhost:3100` ให้ทันที!

### วิธีที่ 2: ก๊อปปี้โฟลเดอร์ผ่าน Flash Drive / Google Drive
1. ก๊อปปี้โฟลเดอร์ `clip-to-manual` ไปวางที่เครื่องทำงาน (แนะนำไว้ที่ `D:\Projects\clip-to-manual` หรือไดรฟ์ C:)
2. ดับเบิลคลิกไฟล์ **`start.bat`** ได้ทันทีโดยไม่ต้องตั้งค่าใดๆ เพิ่มเติม

---

## 📤 ส่วนที่ 2: วิธีบันทึกงานและส่งขึ้น GitHub ก่อนกลับบ้าน (Push from Office)

เมื่อคุณสร้างคู่มือใหม่ หรือมีการแก้ไขโค้ดที่ทำงาน และต้องการนำกลับไปทำต่อที่บ้าน:

1. เปิด Terminal ในโฟลเดอร์โปรเจกต์
2. ตรวจสอบคุณภาพโค้ดก่อนส่งงาน (Quality Gate):
   ```bash
   npm run check
   ```
3. บันทึกและ Push ขึ้น GitHub:
   ```bash
   git add .
   git commit -m "feat: updated manuals and features from office"
   git push origin main
   ```

---

## 🏠 ส่วนที่ 3: วิธีอัปเดตงานเมื่อกลับมาถึงบ้าน (Pull & Continue at Home)

เมื่อกลับมาถึงบ้าน และต้องการทำงานต่อจากที่ทำค้างไว้ที่ออฟฟิศ:

1. เปิด Terminal ในโฟลเดอร์ `clip-to-manual` ที่บ้าน
2. ดึงข้อมูลล่าสุดลงมาด้วยคำสั่งเดียว:
   ```bash
   git pull origin main
   ```
3. ดับเบิลคลิก **`start.bat`** เพื่อทำงานต่อได้ทันที ข้อมูลคู่มือในโฟลเดอร์ `manuals/` และโค้ดล่าสุดจะซิงค์ตรงกัน 100%!

---

## 🌐 ส่วนที่ 4: การตั้งค่าภาษาไทย / UTF-8 แบบ Global (ทำครั้งเดียวในเครื่องใหม่)

หากคอมพิวเตอร์ที่ทำงานยังไม่เคยตั้งค่าภาษาไทยใน Console ให้รันคำสั่งด้านล่างนี้ใน **PowerShell** (ครั้งเดียว):

```powershell
# 1. ตั้งค่า UTF-8 ใน PowerShell Profile ถาวร
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
Add-Content -Path $PROFILE -Value @"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
"@

# 2. ตั้งค่า CMD ให้ใช้ UTF-8 อัตโนมัติ
reg add "HKCU\Software\Microsoft\Command Processor" /v AutoRun /t REG_SZ /d "chcp 65001 > nul" /f

# 3. ตั้งค่า Git ให้แสดงชื่อไฟล์ภาษาไทยอย่างถูกต้อง
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
```

---

## 📋 สรุปวงจรการทำงานประจำวัน (Daily Workflow Cheatsheet)

```text
[เช้าที่ทำงาน]     git pull origin main   ->  ดับเบิลคลิก start.bat  ->  สร้างคู่มือ
[เย็นก่อนกลับ]     npm run check          ->  git commit & push
[ค่ำที่บ้าน]       git pull origin main   ->  ดับเบิลคลิก start.bat  ->  ทำต่อได้ทันที
```
