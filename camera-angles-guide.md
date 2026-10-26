# คู่มือมุมกล้องสำหรับการถ่ายภาพยนตร์ และการเขียน AI Video Prompt

> การเลือกมุมกล้องเป็นหัวใจของการเล่าเรื่องด้วยภาพ เพราะแต่ละมุมสร้างอารมณ์และความหมายของฉากต่างกันโดยสิ้นเชิง

เอกสารนี้แบ่งเป็น 5 ส่วน:

1. **Camera Angles** – ตำแหน่งและองศาของกล้อง (สูง/ต่ำ/เอียง)
2. **Perspective Shots** – มุมมองพิเศษที่กำหนดว่าผู้ชม "ยืนอยู่ตรงไหน" (OTS, POV)
3. **Shot Sizes** – ขนาดภาพ ระยะห่างระหว่างผู้ชมกับตัวละคร
4. **Camera Movements** – การเคลื่อนกล้อง
5. **Deep-Structured Prompts** – โครงสร้างและตัวอย่าง prompt สำหรับ AI Video Generation

> **หลักจำง่าย:** Angle = กล้องอยู่ *ตรงไหน / เงยหรือก้มแค่ไหน* · Size = *ใกล้หรือไกลแค่ไหน* · Movement = *กล้องขยับอย่างไร* ทั้งสามอย่างผสมกันได้อิสระ เช่น "Low-Angle + Medium Shot + Dolly In"

---

## ส่วนที่ 1: Camera Angles (มุมกล้อง)

### 1.1 Eye-Level Shot (มุมระดับสายตา)

- **ลักษณะภาพ:** กล้องอยู่ระดับเดียวกับสายตาตัวละคร หรือความสูงปกติของคน
- **อารมณ์:** สมจริง เป็นธรรมชาติ เป็นกลาง เข้าถึงง่าย ไม่ยัดเยียดอารมณ์ให้ผู้ชม
- **ใช้เมื่อ:**
  - ฉากสนทนาทั่วไป (Dialogue)
  - ฉากที่ต้องการความสนิทสนมเป็นกันเอง
  - ฉากชีวิตประจำวันที่ต้องการความสมจริง

### 1.2 High-Angle Shot (มุมสูง)

- **ลักษณะภาพ:** กล้องอยู่สูงกว่าตัวละคร แล้วก้มมองลงมา
- **อารมณ์:** ตัวละครดูอ่อนแอ ตกเป็นรอง ไร้ทางสู้ ตัวเล็ก โดดเดี่ยว หรือถูกกดดัน
- **ใช้เมื่อ:**
  - ตัวละครตกอยู่ในอันตราย ถูกข่มขู่ หรือสูญเสีย
  - เน้นความเปราะบางของตัวละคร
  - แสดงความกว้างใหญ่ของพื้นที่เพื่อให้ตัวละครดูเล็กและสิ้นหวัง

### 1.3 Low-Angle Shot (มุมต่ำ)

- **ลักษณะภาพ:** กล้องอยู่ต่ำกว่าตัวละคร แล้วเงยขึ้นมอง
- **อารมณ์:** ทรงพลัง ยิ่งใหญ่ น่าเกรงขาม มีอำนาจ หรือน่ากลัว/เป็นภัย
- **ใช้เมื่อ:**
  - เปิดตัวตัวร้าย ฮีโร่ หรือผู้มีอำนาจ
  - ฉากต่อสู้ที่ต้องการให้ตัวละครดูเก่งและเหนือกว่า
  - ทำให้วัตถุ/สถานที่ดูใหญ่โตโอ่อ่าน่าทึ่ง

### 1.4 Worm's-Eye View (มุมมองจากพื้นดิน)

- **ลักษณะภาพ:** กล้องติดพื้นมาก แล้วเงยขึ้นเกือบตรง (สุดขั้วกว่า Low-Angle)
- **อารมณ์:** ยิ่งใหญ่เกินจริง แปลกตา คุกคาม หรือเน้นความโอ่อ่าของสถาปัตยกรรม
- **ใช้เมื่อ:**
  - ตัวละครมองสัตว์ประหลาด ยักษ์ หรือหุ่นยนต์ขนาดใหญ่
  - ต้องการความเร้าใจในฉากเคลื่อนไหว เช่น ก้าวเท้าเดิน ล้อรถวิ่งผ่านหน้ากล้อง

### 1.5 Bird's-Eye View / Top-Down Shot (มุมมองนก / มุมเหนือหัว)

- **ลักษณะภาพ:** กล้องอยู่สูงและทำมุมดิ่ง 90 องศาลงมา (Overhead Shot) *ต่างจาก High-Angle ตรงที่ High-Angle ยังเป็นมุมเฉียงลงมา ส่วน Bird's-Eye มองตรงลงมาเต็มที่*
- **อารมณ์:** เหมือนผู้สังเกตการณ์ (God's Perspective) เด็ดขาด เป็นระเบียบ หรือตัดขาดจากอารมณ์ตัวละคร
- **ใช้เมื่อ:**
  - ฉากสืบสวนหรือที่เกิดเหตุ
  - โชว์ layout ของพื้นที่ การเคลื่อนที่ของกลุ่มคน หรือการไล่ล่าในเขาวงกต
  - สร้างศิลปะจากรูปทรงและลวดลายบนพื้น

### 1.6 Dutch Angle / Dutch Tilt (มุมเอียง)

- **ลักษณะภาพ:** กล้องเอียงไปข้างใดข้างหนึ่ง ทำให้เส้นขอบฟ้าเอียง
- **อารมณ์:** ไม่มั่นคง สับสน วิตกกังวล จิตใจไม่ปกติ มีบางอย่างผิดปกติ หรือน่าสะพรึงกลัว
- **ใช้เมื่อ:**
  - หนังสยองขวัญ หรือ Psychological Thriller
  - ตัวละครเมา โดนวางยา หรือสติหลุด
  - ฉากตื่นตระหนก หรือเหตุการณ์พลิกผันที่ไม่น่าไว้วางใจ
- **ข้อควรระวัง:** ใช้พร่ำเพรื่อจะทำให้ผู้ชมเมื่อยและกลายเป็นเรื่องตลกได้ ควรเก็บไว้ใช้ในจังหวะสำคัญ

### 1.7 Ground-Level Shot (มุมระดับพื้น)

- **ลักษณะภาพ:** กล้องวางต่ำติดพื้น *มองไปในแนวราบ* ให้เห็นเท้า หรือสิ่งของบนพื้นในระดับเดียวกับเลนส์ *(ต่างจาก Worm's-Eye ที่เงยขึ้นมองสูง)*
- **อารมณ์:** เน้นรายละเอียดการเคลื่อนไหวเล็กๆ สร้างจังหวะลุ้นระทึก
- **ใช้เมื่อ:**
  - ฉากดวลปืนสไตล์คาวบอย (เน้นซองปืน เท้า และการย่นระยะเข้าหากัน)
  - ฉากย่องเบา หรือเน้นร่องรอยการเดิน/ย่ำน้ำ

---

## ส่วนที่ 2: Perspective Shots (มุมมองพิเศษ)

> OTS และ POV เป็นการกำหนด "จุดยืนของผู้ชม" ไม่ใช่มุมสูง/ต่ำ จึงแยกออกมาจาก Camera Angles และสามารถนำไปผสมกับมุมในส่วนที่ 1 ได้ (เช่น OTS + Low-Angle)

### 2.1 Over-the-Shoulder Shot (OTS / มุมข้ามไหล่)

- **ลักษณะภาพ:** กล้องอยู่ด้านหลังตัวละครหนึ่ง โดยไหล่หรือศีรษะของเขาติดอยู่ในเฟรม มองไปยังอีกคนที่กำลังคุยด้วย
- **อารมณ์:** การเชื่อมโยง ความสัมพันธ์ การปะทะบทบาท หรือทิศทางความสนใจ
- **ใช้เมื่อ:**
  - บทสนทนาระหว่างตัวละคร 2 คน (มักตัดสลับแบบ Shot/Reverse Shot)
  - ฉากเจรจา สอบสวน หรือฉากความสัมพันธ์หวานซึ้ง

### 2.2 Point of View Shot (POV / มุมมองแทนสายตา)

- **ลักษณะภาพ:** กล้องอยู่ในตำแหน่งสายตาของตัวละคร ให้ผู้ชมเห็นสิ่งที่ตัวละครเห็นโดยตรง
- **อารมณ์:** ร่วมอินกับตัวละคร สมจริงเหมือนอยู่ในเหตุการณ์ ลุ้นระทึกหรือกลัว
- **ใช้เมื่อ:**
  - ฉากผจญภัยแบบ First-Person หรือฉากวิ่งหนีในหนังสยองขวัญ
  - ฉากที่ต้องรับรู้ความรู้สึกเฉพาะ เช่น ตาพร่ามัว มองผ่านกล้องส่องทางไกล หรือส่องผ่านรูกุญแจ

---

## สรุปการเลือกมุมกล้องตามอารมณ์ฉาก

| อารมณ์ / ความต้องการของฉาก | มุมกล้องที่เหมาะสม |
|---|---|
| ข่มขู่ / ทรงพลัง / เปิดตัวฮีโร่ | Low-Angle Shot |
| ยิ่งใหญ่เกินจริง / ตัวใหญ่เหนือมนุษย์ | Worm's-Eye View |
| อ่อนแอ / สิ้นหวัง / โดนกดดัน | High-Angle Shot |
| ตื่นตระหนก / สับสน / สติแตก | Dutch Angle |
| สมจริง / พูดคุยทั่วไป | Eye-Level Shot |
| บทสนทนา 2 คน / เจรจา / ปะทะบทบาท | Over-the-Shoulder Shot |
| ลุ้นระทึก / อินกับเหตุการณ์ | POV Shot |
| ลุ้นระทึกเชิงรายละเอียด / ดวล / ย่องเบา | Ground-Level Shot |
| เห็นภาพรวม / วางแผน / สังเกตการณ์ | Bird's-Eye View |

---

## ส่วนที่ 3: Shot Sizes (ขนาดภาพ)

ขนาดภาพกำหนดระยะห่างระหว่างผู้ชมกับตัวละคร/วัตถุ ยิ่งใกล้ยิ่งใกล้ชิดและเข้มข้น ยิ่งไกลยิ่งเห็นบริบทและความสัมพันธ์กับสถานที่

> ขนาดภาพกำหนดด้วย *ระยะ/เฟรมที่ได้* ไม่จำเป็นต้องเกิดจากการ "ซูม" เสมอไป อาจได้จากการวางกล้องใกล้หรือเปลี่ยนเลนส์

| ขนาดภาพ | ตัวย่อ | เฟรมครอบคลุม |
|---|---|---|
| Extreme Close-Up | ECU | เฉพาะจุด เช่น ดวงตา ปาก หยดน้ำตา วัตถุเล็กๆ |
| Close-Up | CU | ใบหน้าถึงไหล่ |
| Medium Close-Up | MCU | ศีรษะถึงช่วงอก |
| Medium Shot | MS | ศีรษะถึงเอว |
| Medium Long Shot / Cowboy Shot | MLS | ศีรษะถึงเข่า (Cowboy Shot เป็นแบบเฉพาะที่ตัดช่วงกลางต้นขา เห็นซองปืนที่เอว) |
| Long Shot / Wide Shot / Full Shot | LS | เต็มตัวหัวจดเท้า พร้อมสภาพแวดล้อม |
| Extreme Long Shot / Establishing Shot | ELS | ภาพรวมสถานที่ ตัวละครเล็กมาก |

### 3.1 Extreme Close-Up (ECU)

- **อารมณ์:** เข้มข้น กดดัน ตึงเครียด เน้นรายละเอียดที่ห้ามมองข้าม
- **ใช้เมื่อ:** สื่ออารมณ์ลึกผ่านสายตา, ไขปริศนาที่เน้นหลักฐาน, ฉากระทึกขวัญที่เน้นความกลัว

### 3.2 Close-Up (CU)

- **อารมณ์:** เน้นสีหน้าและความรู้สึกอย่างชัดเจน ใกล้ชิด
- **ใช้เมื่อ:** บทสนทนาสำคัญ, ฉากแสดงอารมณ์ (ร้องไห้ ยิ้ม โกรธ), ฉากเผยความลับ

### 3.3 Medium Close-Up (MCU)

- **อารมณ์:** สมดุลระหว่างสีหน้ากับภาษากาย
- **ใช้เมื่อ:** สนทนาทั่วไป, สัมภาษณ์, เล่าเรื่องที่เน้นทั้งคำพูดและการแสดงออก

### 3.4 Medium Shot (MS)

- **อารมณ์:** เป็นธรรมชาติ เหมือนนั่งคุยหรืออยู่ในห้องเดียวกัน
- **ใช้เมื่อ:** สนทนา 2–3 คน, แอ็กชันช่วงบนของร่างกาย, ฉากดำเนินเรื่องทั่วไป

### 3.5 Medium Long Shot / Cowboy Shot (MLS)

- **อารมณ์:** มั่นคง พร้อมปะทะ เห็นภาษากายและสภาพแวดล้อมรอบตัว
- **ใช้เมื่อ:** ฉากดวล, เผชิญหน้า, เตรียมพร้อมทำบางอย่าง

### 3.6 Long Shot / Wide Shot (LS)

- **อารมณ์:** เน้นการเคลื่อนไหว กิริยาท่าทาง และความสัมพันธ์ของตัวละครกับสถานที่
- **ใช้เมื่อ:** เดิน/วิ่ง, เต้น, ต่อสู้, หรือแสดงกิจกรรมในพื้นที่

### 3.7 Extreme Long Shot / Establishing Shot (ELS)

- **อารมณ์:** ยิ่งใหญ่ โดดเดี่ยว เวิ้งว้าง หรือปูบริบทว่าเหตุการณ์เกิดที่ไหน
- **ใช้เมื่อ:** ฉากเปิดเรื่อง, เปิดตัวเมือง/ธรรมชาติ, เน้นความเวิ้งว้างของตัวละคร

---

## ส่วนที่ 4: Camera Movements (การเคลื่อนกล้อง)

การเคลื่อนกล้องเพิ่มมิติ ความสมจริง จังหวะ (Pacing) และความตื่นเต้นให้ภาพยนตร์

### 4.1 Pan (แพนกล้อง)

- **การเคลื่อนที่:** หมุนกล้องในแนวราบ (ซ้าย-ขวา) บนจุดตั้งคงที่
- **อารมณ์:** สแกนมองพื้นที่ ตามการเคลื่อนที่ของตัวละคร/วัตถุ
- **ใช้เมื่อ:** กวาดสายตามองสถานที่, ตามตัวละครที่เดินจากจุดหนึ่งไปอีกจุด
- **รูปแบบพิเศษ:** *Whip Pan* – แพนเร็วจนภาพเบลอ ใช้เปลี่ยนซีนหรือสร้างความฉับไว

### 4.2 Tilt (ทิลท์กล้อง)

- **การเคลื่อนที่:** ก้มหรือเงยหัวกล้องขึ้น-ลงในแนวตั้ง บนจุดตั้งคงที่
- **อารมณ์:** น่าทึ่ง เผยรายละเอียดจากล่างขึ้นบน หรือสังเกตความสูง
- **ใช้เมื่อ:** กวาดมองตึกสูง, เผยชุดแต่งกาย/รูปร่างตัวละครจากเท้าถึงใบหน้า

### 4.3 Dolly (Dolly In / Dolly Out)

- **การเคลื่อนที่:** *ตัวกล้อง* เคลื่อนเข้าใกล้ (Dolly In) หรือถอยออก (Dolly Out) บนรถดอลลี่/ราง
- **อารมณ์:** Dolly In = จดจ่อ ดึงอารมณ์ร่วม ตื่นตัว · Dolly Out = โดดเดี่ยว ปล่อยวาง หรือเปิดเผยบริบท
- **ใช้เมื่อ:** ตัวละครคิดออก/ฉงนใจ, เผยความจริง, จบซีนที่กล้องค่อยๆ ถอยห่าง

### 4.4 Zoom (Zoom In / Zoom Out)

- **การเคลื่อนที่:** เปลี่ยนทางยาวโฟกัสของเลนส์ ดึงภาพเข้าใกล้หรือไกลออก *โดยตัวกล้องไม่ขยับ*
- **อารมณ์:** รู้สึกเหมือนจับจ้องอย่างรวดเร็ว สร้างความตกใจ/ระทึกขวัญ (Quick Zoom)
- **ใช้เมื่อ:** ค้นพบเบาะแสสำคัญทันที, ฉากสไตล์สารคดี, ฉากตลกขบขัน

> **Dolly vs Zoom:** Dolly เปลี่ยน *มุมมองเชิงลึก (perspective)* เพราะตัวกล้องเคลื่อนผ่านฉาก รู้สึกเหมือนเดินเข้าไปจริง ส่วน Zoom เปลี่ยนแค่ขนาดภาพ ฉากหลังจึงแบนลง รู้สึกเหมือนส่องกล้องส่องทางไกล

### 4.5 Tracking / Trucking

- **การเคลื่อนที่:**
  - *Tracking* – กล้องเคลื่อนตามตัวละคร/วัตถุ (ตามหลัง นำหน้าแบบถอยหลัง หรือขนานข้าง)
  - *Trucking* – กล้องเคลื่อนไปด้านข้างในแนวขนาน (ซ้าย/ขวา)
- **อารมณ์:** ร่วมเดินทางไปกับตัวละคร จังหวะภาพลื่นไหล
- **ใช้เมื่อ:** ตัวละคร 2 คนเดินคุยตามทางเดิน, รถวิ่งขนานไปตามถนน, ตัวละครวิ่งเข้าหากล้อง (Backward Tracking)

### 4.6 Crane Shot / Jib Shot (เครนกล้อง)

- **การเคลื่อนที่:** ยกกล้องสูงขึ้นหรือลดต่ำลงด้วยแขนเครน (Jib คือเครนขนาดเล็กกว่า)
- **อารมณ์:** ยิ่งใหญ่ อลังการ ปลดปล่อย หรือเปลี่ยนมุมมองจากจุดเล็กๆ ไปสู่ภาพกว้าง (หรือกลับกัน)
- **ใช้เมื่อ:** เปิดตัวสุดอลังการ, ฉากจบที่กล้องลอยสูงขึ้นเพื่อลาผู้ชม

### 4.7 Dolly Zoom / Vertigo Effect

- **การเคลื่อนที่:** Dolly เข้าหาวัตถุพร้อมกับ Zoom Out (หรือ Dolly Out พร้อม Zoom In) *ขนาดของตัวแบบในเฟรมเกือบคงที่ แต่ฉากหลังบิดยืด/หดอย่างผิดธรรมชาติ*
- **อารมณ์:** มึนงง ตระหนก โลกหมุน ช็อกกับความจริง
- **ใช้เมื่อ:** ตัวละครรู้ความจริงที่น่าตกใจ, ตื่นตระหนกกลางผู้คน, ฉากโรคกลัวความสูง

### 4.8 การเคลื่อนไหวอื่นที่พบบ่อย (เพิ่มเติม)

| ชื่อ | ลักษณะ | อารมณ์ |
|---|---|---|
| Handheld | ถือกล้องด้วยมือ มีการสั่นไหวเล็กน้อย | สมจริง ดิบ ตื่นเต้น เหมาะกับฉากแอ็กชัน/สารคดี |
| Steadicam / Gimbal | กล้องเคลื่อนตามนุ่มนวลโดยไม่มีรางสั่น | ลื่นไหล ตามตัวละครต่อเนื่อง (Long Take) |
| Arc / Orbit Shot | กล้องเคลื่อนเป็นวงโค้งรอบตัวแบบ | เน้นตัวละคร ให้ความรู้สึกสำคัญหรือพิเศษ |
| Rack Focus | เปลี่ยนจุดโฟกัสจากวัตถุหนึ่งไปอีกวัตถุ *(ไม่ใช่การเคลื่อนกล้องโดยตรง แต่ช่วยนำสายตา)* | ชี้ความเชื่อมโยง หรือเปลี่ยนความสนใจ |

### ตารางเทียบการเคลื่อนไหวที่มักสับสน

| ถ้าอยาก... | ใช้ |
|---|---|
| หันกล้องซ้าย-ขวา โดยตัวกล้องอยู่ที่เดิม | Pan |
| ก้ม-เงยกล้อง โดยตัวกล้องอยู่ที่เดิม | Tilt (ไม่ใช่ Pan) |
| เดินเข้าไปหาตัวแบบ | Dolly In |
| ขยายภาพเข้ามาโดยกล้องไม่ขยับ | Zoom In |
| ตามตัวละครที่กำลังเดิน | Tracking |
| ยกกล้องสูงขึ้นทั้งตัว | Crane / Pedestal Up |

---

## ส่วนที่ 5: Deep-Structured Prompts สำหรับ AI Video Generation

ตัวอย่างการเขียน prompt แบบ **Deep-Structured Architecture** สำหรับ AI Video Generation (เช่น MiniMax H3, Seedance 2.5) เพื่อให้ได้ฉากภาพยนตร์ที่สมจริง คงลักษณะตัวละคร/สถานที่ (Subject Retention) ได้ต่อเนื่อง และกำกับมุมกล้องได้ละเอียด

### 5.0 ข้อมูลโมเดลที่ควรรู้ก่อนเขียน

| โมเดล | ความยาวต่อการเจน (ตามข้อมูลสาธารณะ ณ ต.ค. 2026) | ตัวอย่างในเอกสารนี้ |
|---|---|---|
| MiniMax H3 | 5–15 วินาที | ตัวอย่างที่ 1–3 (15 วินาที) |
| Seedance 2.5 | สูงสุด 30 วินาทีต่อการเจน (ต่อขยายได้) | ตัวอย่างที่ 4 (30 วินาที) |

ทั้งสองโมเดลรองรับเสียงในตัว (native audio) และบทพูดแบบซิงก์ปาก แต่ **ความแม่นยำของ lip sync อาจต่างกันตามรุ่นย่อยและโหมด (text/image/reference)** ควรทดสอบจริงก่อนใช้งานเชิงพาณิชย์

### 5.1 โครงสร้างมาตรฐาน (Template)

```
DY,subject_definitions:
<Subject 1> is the [สถานที่/บรรยากาศ] in <Picture 1>, with [รายละเอียดสถานที่ แสง สภาพอากาศ].
<Subject 2> is the [ตัวละครหลัก] shown in <Picture 1> and in [ตำแหน่งใน] <Picture 2>, wearing [เครื่องแต่งกาย], with [ใบหน้า/อารมณ์].
<Subject 3> is the [ตัวละคร/วัตถุรอง] shown in ...

summary:
[reference generation] The target is a [N]-second realistic cinematic [ประเภทฉาก] set inside <Subject 1>. <Picture 1> provides ... <Picture 2> provides ... The scene progresses through [จำนวน] connected shots ...

retention_analysis:
<Subject N> (appears in [Shot x], ...): fully_preserved - [รายละเอียดที่ต้องคงไว้]

detailed_description:
[สไตล์การกำกับโดยรวม + แนวทางบทพูด]

[Shot 1] At 00:00.000, ...
[Shot 2] At 00:05.000, ...
[Shot 3] At 00:10.000, ...

overall_soundscape:
[เสียงแวดล้อมและ foley]

non_diegetic_music:
[ดนตรีประกอบ และการไต่อารมณ์ตามจังหวะฉาก]
```

> **หมายเหตุเรื่องไวยากรณ์:** คำนำหน้า `DY,`, แท็ก `<Subject N>` / `<Picture N>`, แท็ก `<d>[English] ...</d>` และป้ายผู้พูด `(S1)` เป็นรูปแบบเฉพาะที่ผู้เขียนเอกสารนี้ใช้ ควรตรวจกับเอกสารทางการของแต่ละโมเดลอีกครั้งว่ารองรับหรือไม่ หากไม่แน่ใจให้ทดสอบเปรียบเทียบกับ prompt ที่ไม่มีแท็ก

### 5.2 ข้อแนะนำการออกแบบ Deep-Structured Prompts

1. **Subject Definitions** – ให้ `<Subject 1>` เป็นสถานที่/บรรยากาศ และ `<Subject 2>`, `<Subject 3>` เป็นตัวละครหรือวัตถุหลัก พร้อมระบุแหล่งอ้างอิง `<Picture 1>`, `<Picture 2>` ให้ชัดเจน
2. **Retention Analysis** – ระบุสถานะ `fully_preserved` และอธิบายคุณสมบัติภาพที่ต้องคงไว้ (ใบหน้า เครื่องแต่งกาย สถานที่ ฯลฯ) ให้ครบทุก Subject ที่ปรากฏ
3. **บทพูด** – ใช้รูปแบบ `<d>[English] ... </d>` ระบุภาษาในวงเล็บเพื่อช่วยให้เสียงและจังหวะปากตรงกันมากที่สุด
4. **Timestamp ทุก Shot** – ใส่เวลาเริ่มของทุก Shot รวมถึง Shot แรก (`00:00.000`) เพื่อความสม่ำเสมอ
5. **1 Shot = 1 มุมหลัก + 1 การเคลื่อนไหวหลัก** – หลายมุมในชอตเดียวอาจทำให้โมเดลสับสน (ตัวอย่างด้านล่างใช้ได้ถึง 2 มุมใน 1 Shot เมื่อมี "cut" ชัดเจน)
6. **ระยะภาพต้องสอดคล้องกับบทพูด** – ถ้าตัวละครต้องพูดและต้องการ lip sync ให้ใช้ขนาดภาพ **Medium Long Shot ขึ้นไปใกล้กว่านั้น** เพราะ Extreme Long Shot เห็นใบหน้าเล็กเกินไป ปากจะซิงก์ไม่ชัด
7. **ตัวละครประกอบ** – ถ้ามีคนที่ไม่ได้ผูกกับรูปอ้างอิง (เช่น ลูกน้อง/ตัวประกอบ) ให้ระบุชัดว่าเป็น "background extras ไม่ต้องคงใบหน้า" เพื่อไม่ให้ขัดกับ retention
8. **ความต่อเนื่องของรายละเอียด** – พื้นผิว สถานที่ และสภาพอากาศในแต่ละ Shot ต้องไม่ขัดกัน (เช่น พื้นหินเปียก ต้องไม่กลายเป็น "โคลน")
9. **ความยาวของ Shot** – ในคลิป 15 วินาที ราว 5 วินาทีต่อ Shot (3 Shots) กำลังพอดี ไม่ควรยัดแอ็กชันซับซ้อนเกินใน 1 Shot
10. **เรียงให้ครบ 3 ส่วนเสียง** – Dialogue / Soundscape / Music ควรระบุครบทุกฉาก

---

### ตัวอย่างที่ 1: ฉากต่อสู้ด้วยดาบกลางสายฝน (Sword Fight Scene) — *MiniMax H3, 15 วินาที*

```
DY,subject_definitions:
<Subject 1> is the nighttime ancient Asian courtyard environment in <Picture 1>, with dark curved roof tiles, heavy rain pouring, volumetric moonlight, and a wet stone floor reflecting ambient light.
<Subject 2> is the master swordsman shown in <Picture 1> and in the left close-up of <Picture 2>, wearing rain-soaked dark traditional armor, a woven straw hat, with a calm, focused facial expression.
<Subject 3> is the rival assassin shown in <Picture 1> and in the right close-up of <Picture 2>, wearing dark leather warrior attire, bearing facial scars, and a fierce, aggressive expression.

summary:
[reference generation] The target is a 15-second realistic cinematic action scene set inside <Subject 1>. <Picture 1> provides the courtyard environment, rain atmosphere, low-key lighting, and dramatic mood. <Picture 2> provides detailed facial-identity and close-up references for <Subject 2> and <Subject 3>. The scene progresses through three connected action shots during an intense sword clash, with all dialogue performed naturally in English.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the ancient courtyard, wet stone tiles, pouring rain, and dark atmospheric lighting remain visually consistent throughout.
<Subject 2> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the master swordsman's facial identity, straw hat, wet armor, and calm demeanor remain consistent.
<Subject 3> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the rival assassin's facial identity, facial scars, leather attire, and hostile expression remain consistent.

detailed_description:
The target video uses realistic cinematic action directing, dynamic camera moves, slow-motion impact beats, high contrast lighting, and grounded physical momentum. Dialogue is spoken in short, tense English with accurate lip synchronization.

[Shot 1] At 00:00.000, the camera opens on an Extreme Long Shot inside <Subject 1> and descends via a Crane Shot, settling into a Medium Long Shot (Cowboy Shot) as <Subject 2> and <Subject 3> stand facing each other across the wet courtyard under heavy rain. <Subject 3> slowly draws his katana, the steel gleaming in the dark. <Subject 3> (S1) speaks with a cold, mocking tone: <d>[English] Your story ends here tonight.</d> <Subject 2> remains motionless, resting his hand on his sword hilt. <Subject 2> (S2) replies calmly: <d>[English] Then draw your blade.</d>

[Shot 2] At 00:05.000, the video cuts to a Low-Angle Shot with a rapid Tracking Movement as <Subject 3> charges forward, leaping across the wet stone tiles. The camera rapidly transitions to an Extreme Close-Up (ECU) of <Subject 2>'s eyes through the falling rain. Sparks fly dramatically as their blades collide, creating a shockwave that disperses rainwater around them. <Subject 3> (S1) grunts from the resistance: <d>[English] Impressive!</d>

[Shot 3] At 00:10.000, the camera cuts to a Worm's-Eye View with a sharp Pan following <Subject 2>'s counter-strike. <Subject 2> executes a swift arc slash, disarming <Subject 3> and sending his weapon spinning across the wet stone floor. Rain splashes across the lens in slow motion. <Subject 2> sheathes his katana with a clean metallic click as <Subject 3> steps back in defeat.

overall_soundscape:
Heavy rain pouring, distant thunder rumble, sharp metallic blade drawing sounds, loud steel clashes with ringing reverb, dramatic water splashes, and a crisp wooden-metal sheathing click.

non_diegetic_music:
A low, intense cinematic taiko drum beat paired with a dark cello motif that builds rapidly during the charge and hits a sharp climax on the sword clash, settling into a low sustained note at the end.
```

---

### ตัวอย่างที่ 2: ฉากต่อสู้ประชิดตัวในพื้นที่แคบ (Hand-to-Hand Combat in Alley) — *MiniMax H3, 15 วินาที*

```
DY,subject_definitions:
<Subject 1> is the rainy, neon-lit narrow alleyway in <Picture 1>, with wet brick walls, steam rising from puddles, dangling electric wires, high-contrast chiaroscuro lighting, and a claustrophobic night atmosphere.
<Subject 2> is the male protagonist shown in <Picture 1> and in the left close-up of <Picture 2>, wearing a rain-soaked dark tactical jacket, with cut scars on his face, determined eyes, and an agile combat stance.
<Subject 3> is the chief enemy thug shown in <Picture 1> and in the right close-up of <Picture 2>, wearing a heavy leather coat, with a rugged bearded face, intimidating posture, and a hostile expression.

summary:
[reference generation] The target is a 15-second realistic cinematic action scene set inside <Subject 1>. <Picture 1> provides the alley environment, wet reflections, low-key lighting, and intense gritty mood. <Picture 2> provides detailed facial-identity and close-up references for <Subject 2> and <Subject 3>. The scene progresses through three connected action shots during a fast-paced hand-to-hand combat encounter, with all dialogue performed naturally in English. Two unnamed henchmen appear only as background extras and do not require identity retention.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the narrow alley, wet brick textures, neon reflections in water puddles, rising steam, and claustrophobic spatial layout remain visually consistent throughout.
<Subject 2> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the protagonist's facial identity, facial scars, wet tactical jacket, and fierce combat demeanor remain consistent.
<Subject 3> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the enemy thug's facial identity, beard, heavy leather coat, and aggressive demeanor remain consistent.

detailed_description:
The target video uses realistic cinematic action directing, dynamic handheld camera movement, high contrast lighting, natural impact physics, and fast-paced editing. Dialogue is spoken in short, intense English with accurate lip synchronization.

[Shot 1] At 00:00.000, the camera opens on a High-Angle Shot looking down from the wet alley brick wall inside <Subject 1>. <Subject 2> is backed against the wall as <Subject 3> and two background henchmen corner him under flickering neon lights. <Subject 3> steps forward into the light, blocking the escape route. <Subject 3> (S1) speaks with a low, menacing growl: <d>[English] You picked the wrong alley to hide in.</d> <Subject 2> maintains a steady breathing rhythm, quickly adjusting his grip. <Subject 2> (S2) replies calmly without showing fear: <d>[English] Then make your move.</d>

[Shot 2] At 00:05.000, the video cuts to a Point of View (POV) Shot from <Subject 2>'s perspective with a rapid Zoom In as <Subject 3> hurls a heavy right hook directly toward the lens. The camera quickly cuts to a Close-Up (CU) with a subtle Dutch Angle as <Subject 2> parries the heavy strike, counter-striking with a swift palm strike to <Subject 3>'s chin. Raindrops scatter off their coats with each sudden impact. <Subject 3> (S1) grunts loudly in pain, stepping back in shock: <d>[English] You're fast!</d>

[Shot 3] At 00:10.000, the camera cuts to a Ground-Level Shot aligned with the wet pavement puddles. <Subject 2> executes a swift hip throw, slamming <Subject 3> violently onto the wet ground. Water splashes dramatically across the camera lens. As <Subject 3> groans on the ground unable to get back up immediately, <Subject 2> quickly steps over him, glances toward the remaining alley exit, and speeds off into the foggy darkness. The camera stays motionless at ground level as <Subject 2>'s footsteps fade away.

overall_soundscape:
Continuous heavy rain pouring in the narrow space, water dripping from rusted pipes, buzzing neon light hums, heavy foot stomps on wet concrete, dull thuds of body hits, dynamic water splashes, and intense guttural breathing.

non_diegetic_music:
A low, pulsing cinematic percussion track with dark synth basslines that builds tension during the confrontation and hits a sharp rhythmic peak during the physical impacts, fading into a low hum as the protagonist escapes.
```

---

### ตัวอย่างที่ 3: ฉากหลบหนีการไล่ล่าข้ามหลังคาเมือง (Rooftop Chase Scene) — *MiniMax H3, 15 วินาที*

```
DY,subject_definitions:
<Subject 1> is the rain-slicked cyberpunk rooftop environment in <Picture 1>, with towering skyscrapers, glowing neon signs, wet roof surfaces, sweeping drone searchlights, and a high-altitude night setting.
<Subject 2> is the athletic courier protagonist shown in <Picture 1> and in the left close-up of <Picture 2>, wearing a blue-accented tactical jacket, with sweat on his face and a desperate, determined expression.
<Subject 3> is the pursuing security drone shown in <Picture 1> and in the right reference of <Picture 2>, featuring a sleek metallic body, bright red searchlight beams, and hovering thrusters.

summary:
[reference generation] The target is a 15-second realistic cinematic escape scene set inside <Subject 1>. <Picture 1> provides the rooftop skyline, neon lighting, rain reflections, and high-stakes chase mood. <Picture 2> provides detailed character and drone asset references for <Subject 2> and <Subject 3>. The scene progresses through three connected chase shots during a high-risk rooftop leap, with minimal urgent dialogue in English.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the cyberpunk rooftop, skyscraper skyline, neon reflections, rain effect, and high-altitude spatial scale remain consistent.
<Subject 2> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the courier's facial identity, blue-accented jacket, sweat textures, and athletic movements remain consistent.
<Subject 3> (appears in [Shot 1], [Shot 3]): fully_preserved - the security drone's mechanical design, red searchlights, and hovering motion remain consistent.

detailed_description:
The target video uses high-energy cinematic chase directing, fast backward tracking shots, vertigo effects, and immersive spatial sound design. Short frantic dialogue is spoken in English with lip sync.

[Shot 1] At 00:00.000, the camera opens on a Medium Close-Up (MCU) with a smooth Tracking Shot moving backward ahead of <Subject 2> inside <Subject 1>. <Subject 2> runs frantically toward the camera, heavy breath visible in the cold air. Red searchlights from <Subject 3> sweep over him from above. <Subject 2> (S1) gasps urgently to himself: <d>[English] Almost there, just keep moving!</d>

[Shot 2] At 00:05.000, the camera cuts to an Over-the-Shoulder (OTS) Low-Angle Shot as <Subject 2> reaches the rooftop edge. He looks down at the massive drop between buildings, then leaps into the air. The camera cuts instantly to a Bird's-Eye View (Top-Down 90-degree Shot) looking straight down into the urban abyss as <Subject 2> soars mid-air across the gap between skyscrapers.

[Shot 3] At 00:10.000, the camera cuts to a Ground-Level Shot on the opposite roof, executing a fast Dolly Zoom (Vertigo Effect) as <Subject 2> lands in a forward roll across wet roof tiles. He quickly leaps back up and disappears through a dark rooftop stairwell door. <Subject 3> hovers at the edge of the previous building, searchlights scanning helplessly.

overall_soundscape:
Heavy running footsteps on wet metal, intense human panting, high-pitched mechanical drone thruster hums, howling high-altitude wind, and wet impact sounds upon landing.

non_diegetic_music:
A fast-paced synthwave/industrial hybrid soundtrack with driving kick drums and tense arpeggios that reaches a crescendo during the jump and cuts to atmospheric sub-bass as he escapes.
```

---

### ตัวอย่างที่ 4: เด็กสาวปั่นจักรยานหลบแมว (30-Second Single Pass) — *Seedance 2.5, 30 วินาที*

```
DY,subject_definitions:
<Subject 1> is the sun-drenched suburban neighborhood street in <Picture 1>, featuring blooming cherry blossom trees, clean paved sidewalks, warm golden hour sunlight, and a peaceful afternoon atmosphere.
<Subject 2> is the young teenage girl protagonist shown in <Picture 1> and in the left close-up of <Picture 2>, wearing a yellow summer dress, a straw hat, with expressive energetic eyes and a cheerful smile.
<Subject 3> is the fluffy ginger cat shown in <Picture 1> and in the right reference of <Picture 2>, featuring bright green eyes, thick orange fur, and a playful, curious demeanor.

summary:
[reference generation] The target is a 30-second continuous realistic cinematic sequence set inside <Subject 1>. <Picture 1> provides the vibrant suburban street environment, warm lighting, and joyful mood. <Picture 2> provides detailed facial and asset references for <Subject 2> and <Subject 3>. The scene seamlessly transitions across three dynamic action beats as <Subject 2> rides her bicycle and swerves safely to avoid <Subject 3>, with all dialogue performed naturally in English.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the suburban street, cherry blossom trees, warm afternoon sunlight, and cozy residential neighborhood remain visually consistent throughout.
<Subject 2> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the teenage girl's facial identity, yellow dress, straw hat, and animated facial expressions remain consistent.
<Subject 3> (appears in [Shot 2], [Shot 3]): fully_preserved - the ginger cat's fur patterns, green eyes, size, and nimble physical movements remain consistent.

detailed_description:
The target video uses fluid continuous shot directing, dynamic tracking camera movement, low-angle perspective switches, natural physics momentum, and vibrant warm color grading. Dialogue is spoken in clear, expressive English with precise lip synchronization.

[Shot 1] At 00:00.000, the video begins with a smooth Tracking Shot moving backward ahead of <Subject 2> riding her vintage bicycle down the sunny street inside <Subject 1>. Petals gently fall around her as she pedals effortlessly. <Subject 2> hums a cheerful tune, then breaks into a bright exclamation. <Subject 2> (S1) speaks with a joyful laugh: <d>[English] What a beautiful afternoon for a ride!</d>

[Shot 2] At 00:10.000, the camera transitions seamlessly to a Low-Angle Ground-Level Shot near the curb where <Subject 3> suddenly trots out from behind a hedge into the bike lane. The camera tilts rapidly up to a Close-Up (CU) of <Subject 2>'s shocked reaction as her eyes widen. She swiftly pulls the handbrakes, swerving her bicycle in a smooth arc onto the soft grass verge. <Subject 2> (S1) gasps frantically: <d>[English] Whoa! Watch out, little buddy!</d>

[Shot 3] At 00:20.000, the camera smoothly arcs around to a Medium Shot (MS) as the bicycle comes to a safe stop on the lawn. <Subject 3> sits calmly on the sidewalk, letting out a soft meow without any fear. <Subject 2> lets out a relieved sigh, places one foot on the ground, and adjusts her straw hat with a warm smile. <Subject 2> (S1) giggles gently: <d>[English] You scared me! You're lucky I have quick reflexes.</d>

overall_soundscape:
Soft breeze rustling tree leaves, bicycle chain whirring, gentle tire rolling sounds over asphalt, sudden sharp squeak of bicycle brakes, soft thud on grass, a cute feline meow, and cheerful suburban birds chirping.

non_diegetic_music:
An uplifting, light acoustic guitar and piano melody that plays softly during the ride, ramps up into a playful staccato rhythm during the swerve, and resolves into a warm, cozy musical phrase as the girl smiles.
```

---

## Checklist ก่อนส่ง Prompt

- [ ] ความยาวคลิปไม่เกินที่โมเดลรองรับ (H3: 5–15 วิ / Seedance 2.5: ถึง 30 วิ)
- [ ] ทุก `<Subject>` มีทั้งใน `subject_definitions` และ `retention_analysis`
- [ ] Shot ที่ Subject ปรากฏใน `retention_analysis` ตรงกับ Shot จริง
- [ ] ทุก Shot มี timestamp (รวม Shot แรก)
- [ ] Shot ที่มีบทพูดใช้ขนาดภาพที่เห็นใบหน้าชัด (MLS ขึ้นไปใกล้กว่านั้น)
- [ ] ใช้ชื่อการเคลื่อนไหวถูกต้อง (ก้ม/เงย = Tilt, หันซ้าย/ขวา = Pan, วนรอบ = Arc)
- [ ] รายละเอียดฉาก (พื้นผิว สภาพอากาศ แสง) ไม่ขัดกันระหว่าง Shot
- [ ] มีครบ `overall_soundscape` และ `non_diegetic_music` ทุกตัวอย่าง
- [ ] บทพูดใช้แท็ก `<d>[ภาษา] ... </d>` และป้ายผู้พูด `(S#)` สม่ำเสมอ

---

## ภาคผนวก: บันทึกการแก้ไขจากต้นฉบับ

**ข้อผิดพลาดที่แก้**

| # | จุดที่พบ | การแก้ไข |
|---|---|---|
| 1 | ตัวอย่างที่ 3 ไม่มีเนื้อหาใน `non_diegetic_music` ส่วนเพลง synthwave ไปหลุดอยู่ท้ายตัวอย่างที่ 4 | ย้ายกลับไปไว้ในตัวอย่างที่ 3 |
| 2 | ตัวอย่างที่ 4 Shot 2 เขียนว่า "pans rapidly **up**" ซึ่งการเงยขึ้นคือ Tilt ไม่ใช่ Pan | แก้เป็น "tilts rapidly up" |
| 3 | ตัวอย่างที่ 1 Shot 3 พื้นเป็นหินเปียก แต่อาวุธตกลง "in the mud" | แก้เป็น "across the wet stone floor" |
| 4 | ตัวอย่างที่ 1 สรุปมี "a intense" | แก้เป็น "an intense" |
| 5 | ป้าย `(S1)(S2)(S3)` ใช้ไม่สม่ำเสมอ: ตัวอย่าง 1–2 เป็นป้ายผู้พูด แต่ตัวอย่าง 4 กลายเป็นลำดับ Shot | ใช้ป้ายผู้พูดทุกตัวอย่าง (ตัวอย่าง 4 มีผู้พูดคนเดียวจึงเป็น S1 ทั้งหมด) |
| 6 | Timestamp ไม่ครบ: Shot แรกของทุกตัวอย่างไม่มีเวลา | เติม `At 00:00.000` |
| 7 | `retention_analysis` ระบุ Subject 3 ในตัวอย่างที่ 3 และ Subject 3 (แมว) ในตัวอย่างที่ 4 ว่าปรากฏทุก Shot ทั้งที่ไม่จริง | แก้ให้ตรงกับ Shot ที่ปรากฏจริง |
| 8 | ตัวอย่างที่ 2 มี "two thugs" ที่ไม่ได้นิยามเป็น Subject | ระบุเป็น background extras ไม่ต้อง retention |
| 9 | ตัวอย่างที่ 1 Shot 1 มีบทพูดแต่เปิดด้วย Extreme Long Shot ทำให้ lip sync ไม่ชัด | ให้เครนลงมาจบที่ Medium Long Shot |
| 10 | ตัวอย่างที่ 3: "dark stairwell alley" คลุมเครือ | แก้เป็น "dark rooftop stairwell door" |
| 11 | ตัวอย่างที่ 4: "humming slows, turning into..." อ่านไม่ลื่น และมี "with accurate lip sync" ปนอยู่ในบรรยายแอ็กชัน | เกลาประโยค และย้ายเรื่อง lip sync ไปไว้ที่ `detailed_description` |
| 12 | ตัวอย่างที่ 2 บทพูดมีคำหยาบ ("Fast bastard!") ซึ่งอาจถูกกรองโดยบางแพลตฟอร์ม | เปลี่ยนเป็น "You're fast!" (ปรับกลับได้ตามต้องการ) |

**ปรับปรุงเนื้อหา**

- แยก OTS และ POV ออกจาก Camera Angles เพราะเป็น Perspective Shot
- เพิ่มคำอธิบายความต่างระหว่าง Ground-Level กับ Worm's-Eye, High-Angle กับ Bird's-Eye, Tracking กับ Trucking, Dolly กับ Zoom
- แก้คำอธิบาย ECU ที่ใช้คำว่า "ซูม" (ขนาดภาพไม่จำเป็นต้องมาจากการซูม) และแยก Cowboy Shot ออกจาก Medium Long Shot
- เพิ่มตารางสรุปมุมกล้องให้ครบ (เดิมขาด Worm's-Eye, OTS, Ground-Level) และเพิ่มหมวดการเคลื่อนไหวอื่น (Handheld, Steadicam, Arc, Whip Pan, Rack Focus)
- เพิ่มตารางข้อมูลโมเดล แนวทางเขียน prompt และ checklist

**ที่ควรตรวจสอบเพิ่ม**

- ไวยากรณ์เฉพาะ (`DY,`, `<Subject N>`, `<d>...</d>`, `(S#)`) ผมไม่สามารถยืนยันได้จากเอกสารทางการ ควรทดสอบกับโมเดลจริง
- ความเข้ากันของการเคลื่อนกล้องที่ซับซ้อน (เช่น Dolly Zoom ขณะตัวละครกำลังกลิ้งลงพื้น) ขึ้นอยู่กับผลลัพธ์จากโมเดลจริง อาจต้องลดความซับซ้อนหากเพี้ยน
