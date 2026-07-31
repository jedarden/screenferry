# QR Encoding Capacity, Modes, Error Correction, and JS Generation Libraries

Research for **screenferry** — a static, serverless web app that transfers a file device-to-device
purely optically (sender screen → receiver camera).

**Scope of this document:** QR symbol capacity, encoding-mode selection for binary payloads,
error-correction-level choice for a screen→camera channel, practical decode limits imposed by
camera resolution, JavaScript QR *generation* libraries, and rendering strategy for a stable
high frame rate.

**Method note:** the capacity tables below were not copied from a blog. They were generated
programmatically from the reference tables in [node-qrcode](https://github.com/soldair/node-qrcode)
(`lib/core/version.js`, `lib/core/error-correction-code.js`, `lib/core/utils.js`) and
independently cross-checked two ways:

1. Recomputed from first principles — `floor((dataCodewords*8 - 4 - charCountBits) / 8)` for byte
   mode, and the 11-bits-per-character-pair rule for alphanumeric mode — with char-count-indicator
   widths of 8/16/16 bits (byte) and 9/11/13 bits (alphanumeric) for versions 1–9 / 10–26 / 27–40.
   **All 160 version × EC-level combinations matched exactly in both modes.**
2. Spot-checked against the published ISO/IEC 18004 capacity table at
   [thonky.com/qr-code-tutorial/character-capacities](https://www.thonky.com/qr-code-tutorial/character-capacities)
   — v10, v15, v20 and v40 match to the digit.

---

## 1. QR versions, symbol sizes, and exact byte capacity

A QR symbol of version *v* is `(17 + 4v) × (17 + 4v)` modules. ISO/IEC 18004 additionally requires a
**4-module quiet zone** on all four sides, so the space you must actually reserve on screen is
`(25 + 4v)` modules across. Every capacity number below is the *payload* capacity for a symbol
containing a **single segment** in the stated mode (mode indicator + character count indicator
already deducted).

### 1.1 Key versions — detailed

| Ver | Modules | +Quiet zone | Total CW | EC level | Data CW | EC CW | **BYTE capacity (bytes)** | **ALPHANUMERIC capacity (chars)** |
|---|---|---|---|---|---|---|---|---|
| **10** | 57×57 | 65 | 346 | L | 274 | 72 | **271** | **395** |
| | | | | M | 216 | 130 | **213** | **311** |
| | | | | Q | 154 | 192 | **151** | **221** |
| | | | | H | 122 | 224 | **119** | **174** |
| **15** | 77×77 | 85 | 655 | L | 523 | 132 | **520** | **758** |
| | | | | M | 415 | 240 | **412** | **600** |
| | | | | Q | 295 | 360 | **292** | **426** |
| | | | | H | 223 | 432 | **220** | **321** |
| **20** | 97×97 | 105 | 1085 | L | 861 | 224 | **858** | **1249** |
| | | | | M | 669 | 416 | **666** | **970** |
| | | | | Q | 485 | 600 | **482** | **702** |
| | | | | H | 385 | 700 | **382** | **557** |
| **25** | 117×117 | 125 | 1588 | L | 1276 | 312 | **1273** | **1853** |
| | | | | M | 1000 | 588 | **997** | **1451** |
| | | | | Q | 718 | 870 | **715** | **1041** |
| | | | | H | 538 | 1050 | **535** | **779** |
| **30** | 137×137 | 145 | 2185 | L | 1735 | 450 | **1732** | **2520** |
| | | | | M | 1373 | 812 | **1370** | **1994** |
| | | | | Q | 985 | 1200 | **982** | **1429** |
| | | | | H | 745 | 1440 | **742** | **1080** |
| **33** | 149×149 | 157 | 2611 | L | 2071 | 540 | **2068** | **3009** |
| | | | | M | 1631 | 980 | **1628** | **2369** |
| | | | | Q | 1171 | 1440 | **1168** | **1700** |
| | | | | H | 901 | 1710 | **898** | **1307** |
| **40** | 177×177 | 185 | 3706 | L | 2956 | 750 | **2953** | **4296** |
| | | | | M | 2334 | 1372 | **2331** | **3391** |
| | | | | Q | 1666 | 2040 | **1663** | **2420** |
| | | | | H | 1276 | 2430 | **1273** | **1852** |

### 1.2 Absolute maximum

> **v40-L, byte mode = 2953 bytes** in a 177×177 symbol (185×185 including the mandatory quiet
> zone). This is the hard ceiling for a single QR symbol. Confirmed independently by Blockchain
> Commons BCR-2020-005: *"Version 40 QR codes, using the binary encoding mode and the lowest level
> of error correction have a capacity of 2,953 bytes."*
> ([BCR-2020-005](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md))

The alphanumeric-mode ceiling is **4296 characters** at v40-L.

### 1.3 Full table, all 40 versions

Byte and alphanumeric capacities for every version and EC level. Format: `L/M/Q/H`.

| Ver | Modules | Total CW | Data CW L/M/Q/H | Byte cap L/M/Q/H | Alnum cap L/M/Q/H |
|---|---|---|---|---|---|
| 1 | 21x21 | 26 | 19/16/13/9 | 17/14/11/7 | 25/20/16/10 |
| 2 | 25x25 | 44 | 34/28/22/16 | 32/26/20/14 | 47/38/29/20 |
| 3 | 29x29 | 70 | 55/44/34/26 | 53/42/32/24 | 77/61/47/35 |
| 4 | 33x33 | 100 | 80/64/48/36 | 78/62/46/34 | 114/90/67/50 |
| 5 | 37x37 | 134 | 108/86/62/46 | 106/84/60/44 | 154/122/87/64 |
| 6 | 41x41 | 172 | 136/108/76/60 | 134/106/74/58 | 195/154/108/84 |
| 7 | 45x45 | 196 | 156/124/88/66 | 154/122/86/64 | 224/178/125/93 |
| 8 | 49x49 | 242 | 194/154/110/86 | 192/152/108/84 | 279/221/157/122 |
| 9 | 53x53 | 292 | 232/182/132/100 | 230/180/130/98 | 335/262/189/143 |
| 10 | 57x57 | 346 | 274/216/154/122 | 271/213/151/119 | 395/311/221/174 |
| 11 | 61x61 | 404 | 324/254/180/140 | 321/251/177/137 | 468/366/259/200 |
| 12 | 65x65 | 466 | 370/290/206/158 | 367/287/203/155 | 535/419/296/227 |
| 13 | 69x69 | 532 | 428/334/244/180 | 425/331/241/177 | 619/483/352/259 |
| 14 | 73x73 | 581 | 461/365/261/197 | 458/362/258/194 | 667/528/376/283 |
| 15 | 77x77 | 655 | 523/415/295/223 | 520/412/292/220 | 758/600/426/321 |
| 16 | 81x81 | 733 | 589/453/325/253 | 586/450/322/250 | 854/656/470/365 |
| 17 | 85x85 | 815 | 647/507/367/283 | 644/504/364/280 | 938/734/531/408 |
| 18 | 89x89 | 901 | 721/563/397/313 | 718/560/394/310 | 1046/816/574/452 |
| 19 | 93x93 | 991 | 795/627/445/341 | 792/624/442/338 | 1153/909/644/493 |
| 20 | 97x97 | 1085 | 861/669/485/385 | 858/666/482/382 | 1249/970/702/557 |
| 21 | 101x101 | 1156 | 932/714/512/406 | 929/711/509/403 | 1352/1035/742/587 |
| 22 | 105x105 | 1258 | 1006/782/568/442 | 1003/779/565/439 | 1460/1134/823/640 |
| 23 | 109x109 | 1364 | 1094/860/614/464 | 1091/857/611/461 | 1588/1248/890/672 |
| 24 | 113x113 | 1474 | 1174/914/664/514 | 1171/911/661/511 | 1704/1326/963/744 |
| 25 | 117x117 | 1588 | 1276/1000/718/538 | 1273/997/715/535 | 1853/1451/1041/779 |
| 26 | 121x121 | 1706 | 1370/1062/754/596 | 1367/1059/751/593 | 1990/1542/1094/864 |
| 27 | 125x125 | 1828 | 1468/1128/808/628 | 1465/1125/805/625 | 2132/1637/1172/910 |
| 28 | 129x129 | 1921 | 1531/1193/871/661 | 1528/1190/868/658 | 2223/1732/1263/958 |
| 29 | 133x133 | 2051 | 1631/1267/911/701 | 1628/1264/908/698 | 2369/1839/1322/1016 |
| 30 | 137x137 | 2185 | 1735/1373/985/745 | 1732/1370/982/742 | 2520/1994/1429/1080 |
| 31 | 141x141 | 2323 | 1843/1455/1033/793 | 1840/1452/1030/790 | 2677/2113/1499/1150 |
| 32 | 145x145 | 2465 | 1955/1541/1115/845 | 1952/1538/1112/842 | 2840/2238/1618/1226 |
| 33 | 149x149 | 2611 | 2071/1631/1171/901 | 2068/1628/1168/898 | 3009/2369/1700/1307 |
| 34 | 153x153 | 2761 | 2191/1725/1231/961 | 2188/1722/1228/958 | 3183/2506/1787/1394 |
| 35 | 157x157 | 2876 | 2306/1812/1286/986 | 2303/1809/1283/983 | 3351/2632/1867/1431 |
| 36 | 161x161 | 3034 | 2434/1914/1354/1054 | 2431/1911/1351/1051 | 3537/2780/1966/1530 |
| 37 | 165x165 | 3196 | 2566/1992/1426/1096 | 2563/1989/1423/1093 | 3729/2894/2071/1591 |
| 38 | 169x169 | 3362 | 2702/2102/1502/1142 | 2699/2099/1499/1139 | 3927/3054/2181/1658 |
| 39 | 173x173 | 3532 | 2812/2216/1582/1222 | 2809/2213/1579/1219 | 4087/3220/2298/1774 |
| 40 | 177x177 | 3706 | 2956/2334/1666/1276 | 2953/2331/1663/1273 | 4296/3391/2420/1852 |

Useful shortcuts:
- **Symbol size** = `17 + 4v` modules; add 8 for the quiet zone.
- **Byte capacity grows roughly quadratically** with version — v40 holds ~11× what v10 holds, but is
  only ~3.1× wider.
- **Data codewords** = total codewords − EC codewords. Byte capacity is always
  `dataCodewords − 1` (v1–9, 1-byte overhead) or `dataCodewords − 3` (v10–40, 2.5-byte overhead
  rounded).

---

## 2. Encoding-mode tradeoffs for binary payloads

### 2.1 The theory in one table

QR's four modes pack characters at different bit densities. What matters for us is
**data bits carried per bit of QR capacity consumed**:

| Scheme | QR mode | Chars per byte | QR bits per char | Data bits / QR bit | **Efficiency** |
|---|---|---|---|---|---|
| **Raw binary** | byte | 1 | 8 | 8/8 | **100.00%** |
| **base45** (RFC 9285) | alphanumeric | 1.5 | 5.5 | 16/16.5 | **96.97%** |
| base32 / z-base-32 (uppercased) | alphanumeric | 1.6 | 5.5 | 5/5.5 | **90.91%** |
| base64 / base64url | byte | 1.333 | 8 | 6/8 | **75.00%** |
| hex | alphanumeric | 2 | 5.5 | 4/5.5 | **72.73%** |
| Bytewords (Blockchain Commons) | alphanumeric | 2 (minimal form) | 5.5 | 4/5.5 | **72.73%** |

Alphanumeric mode packs **two characters into 11 bits** (5.5 bits/char) over a 45-symbol alphabet
`0-9 A-Z space $ % * + - . / :`. Since `log2(45) = 5.4919`, alphanumeric mode is 99.85% efficient
*as a text channel* — Adam Langley works this out in
[Efficient QR codes](https://www.imperialviolet.org/2021/08/26/qrencoding.html). base45 exploits
this almost perfectly: 2 bytes (16 bits) → 3 chars (16.5 QR bits), a 3.03% loss.
[RFC 9285](https://www.rfc-editor.org/rfc/rfc9285.html) confirms the 2-bytes-to-3-chars mapping
(`n = a*256 + b`, then `n = c + d*45 + e*45²`) and the odd trailing byte → 2 chars.

Note the counter-intuitive result Langley points out: **numeric mode is also excellent** — 3 digits
in 10 bits = 99.66% as a text channel. But converting binary to decimal requires bignum division,
so the practical chunked variant loses more (~98.8% with 7-byte chunks), and it still can't beat
raw byte mode. Not worth it here.

### 2.2 Effective net binary bytes per frame

Assuming an **8-byte per-frame header** (fountain seed / block index + payload length + CRC),
carried inside the encoded payload:

| Ver | EC | byte gross | **byte net** | b64/byte net | **b45/alnum net** | b32/alnum net | hex/alnum net | b45 vs byte |
|---|---|---|---|---|---|---|---|---|
| 10 | L | 271 | **263** | 195 | **255** | 238 | 189 | 97.0% |
| 10 | M | 213 | **205** | 151 | **199** | 186 | 147 | 97.1% |
| 10 | Q | 151 | **143** | 105 | **139** | 130 | 102 | 97.2% |
| 10 | H | 119 | **111** | 81 | **108** | 100 | 79 | 97.3% |
| 15 | L | 520 | **512** | 382 | **497** | 465 | 371 | 97.1% |
| 15 | M | 412 | **404** | 301 | **392** | 367 | 292 | 97.0% |
| 15 | Q | 292 | **284** | 211 | **276** | 258 | 205 | 97.2% |
| 15 | H | 220 | **212** | 157 | **206** | 192 | 152 | 97.2% |
| 20 | L | 858 | **850** | 635 | **824** | 772 | 616 | 96.9% |
| 20 | M | 666 | **658** | 491 | **638** | 598 | 477 | 97.0% |
| 20 | Q | 482 | **474** | 353 | **460** | 430 | 343 | 97.0% |
| 20 | H | 382 | **374** | 278 | **363** | 340 | 270 | 97.1% |
| 25 | L | 1273 | **1265** | 946 | **1227** | 1150 | 918 | 97.0% |
| 25 | M | 997 | **989** | 739 | **959** | 898 | 717 | 97.0% |
| 25 | Q | 715 | **707** | 528 | **686** | 642 | 512 | 97.0% |
| 25 | H | 535 | **527** | 393 | **511** | 478 | 381 | 97.0% |
| 30 | L | 1732 | **1724** | 1291 | **1672** | 1567 | 1252 | 97.0% |
| 30 | M | 1370 | **1362** | 1019 | **1321** | 1238 | 989 | 97.0% |
| 30 | Q | 982 | **974** | 728 | **944** | 885 | 706 | 96.9% |
| 30 | H | 742 | **734** | 548 | **712** | 667 | 532 | 97.0% |
| 33 | L | 2068 | **2060** | 1543 | **1998** | 1872 | 1496 | 97.0% |
| 33 | M | 1628 | **1620** | 1213 | **1571** | 1472 | 1176 | 97.0% |
| 33 | Q | 1168 | **1160** | 868 | **1125** | 1054 | 842 | 97.0% |
| 33 | H | 898 | **890** | 665 | **863** | 808 | 645 | 97.0% |
| 40 | L | 2953 | **2945** | 2206 | **2856** | 2677 | 2140 | 97.0% |
| 40 | M | 2331 | **2323** | 1740 | **2252** | 2111 | 1687 | 96.9% |
| 40 | Q | 1663 | **1655** | 1239 | **1605** | 1504 | 1202 | 97.0% |
| 40 | H | 1273 | **1265** | 946 | **1226** | 1149 | 918 | 96.9% |

### 2.3 Verdict: raw byte mode wins at every version, and the answer never flips

**Raw byte mode is strictly optimal at every version and every EC level.** The ranking
`byte > base45 > base32 > base64 > hex/bytewords` is fixed by the bits-per-character arithmetic,
which is version-independent. The only version-dependent term is the char-count indicator
(byte: 8/16/16 bits vs alphanumeric: 9/11/13 bits) — a difference of at most 5 bits out of ~23,000
at v40. **There is no crossover version.**

Concretely, **base45 costs you ~3% of payload** — at v40-L that is 89 bytes per frame (2945 → 2856).
That is cheap. Which is why the decision is *not* made on capacity grounds:

**base64 is never justified.** It costs 25% and buys nothing that base45 doesn't buy more cheaply.
If you need a text-safe payload, base45 is strictly better than base64 *and* base32 *and* hex.
Delete base64 from consideration.

**z-base-32 is base32 with a different alphabet** (`ybndrfg8ejkmcpqxot1uwisza345h769`). Uppercased,
every character is in the QR alphanumeric set, so it works — at the same 90.91% efficiency as
standard base32. Its whole reason to exist is human transcription robustness, which is irrelevant
for a machine-to-machine optical channel. Skip it.

### 2.4 The real reason anyone picks alphanumeric: decoder compatibility

Byte mode's 100% efficiency is only realisable if the **decoder hands you back raw bytes**. Several
real decoders do not:

- **The browser-native [Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
  exposes only `rawValue: DOMString`.** There is no byte array. Binary payloads get lossily coerced
  through a text decoder, and implementations have historically returned "Unknown encoding" for
  binary QR content
  ([android-vision#156](https://github.com/googlesamples/android-vision/issues/156)). **If screenferry
  wants to use the fast, hardware-accelerated native `BarcodeDetector`, raw byte mode is off the
  table.** This is the single most important constraint in this whole section.
- **ZXing's `Result.getRawBytes()`** returns the raw *bitstream including QR headers*, not the
  payload — you'd have to reimplement `DecodedBitStreamParser` to use it
  ([zxing#1546](https://github.com/zxing/zxing/issues/1546)).
- Charset ambiguity is genuinely bad: the 2000 edition of ISO/IEC 18004 said byte mode is JIS X
  0201; the 2005 edition changed it to ISO/IEC 8859-1; and UTF-8 content *should* carry an ECI
  header but usually doesn't
  ([ImperialViolet](https://www.imperialviolet.org/2021/08/26/qrencoding.html)).
- Blockchain Commons explicitly rejected byte mode for this reason: *"the native binary encoding
  mode of QR codes is not consistently supported by readers"*, and UR deliberately
  *"avoid[s] the use of QR code binary mode to support transparency and wide compatibility"*
  ([BCR-2020-005](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md)).

**But screenferry controls both ends.** We write the encoder and the decoder. So the question reduces to:
*does our chosen decoder library return raw bytes?*

- **[jsQR](https://github.com/cozmo/jsQR) does** — the result object has `binaryData:
  Uint8ClampedArray`, documented as "the raw bytes of the QR code". Apache-2.0.
- **zxing-cpp compiled to WASM does** — it exposes the byte payload, and it is what
  [decimen-optical-transfer](https://github.com/bashalarmistalt/decimen-optical-transfer/) uses.

**Verified empirically here.** I round-tripped random binary payloads at *full capacity* through
node-qrcode (encode, byte mode, `Uint8Array`) → rendered RGBA bitmap → jsQR (decode), across
versions 20 / 27 / 33 / 40 and mask patterns auto / 0 / 3 / 7:

> **16 of 16 exact byte-for-byte matches**, including payloads containing `0x00` and the full
> `0x80–0xFF` range. `jsQR`'s `binaryData` field preserves arbitrary binary losslessly.

So: **use raw byte mode, and pick a decoder that returns bytes.** Keep base45 in the back pocket as
a compatibility fallback profile — it costs only 3% and it is the only encoding that makes a
`BarcodeDetector`-based fast path viable. (Decoding is out of scope for this document, but the
encoder must be built so the mode is a swappable parameter, not a hardcoded assumption.)

---

## 3. Error correction level for a screen→camera channel

### 3.1 What each level actually buys

Reed-Solomon corrects up to `floor(ecCodewords / 2)` **errors** per block (or up to `ecCodewords`
**erasures**, if positions are known — which they are not, in practice, for a camera decode).

| Ver | EC | blocks | block len (CW) | EC CW/block | correctable CW/block | % of block correctable | EC overhead |
|---|---|---|---|---|---|---|---|
| 10 | L | 4 | 86.5 | 18.0 | 9 | 10.4% | 20.8% |
| 10 | M | 5 | 69.2 | 26.0 | 13 | 18.8% | 37.6% |
| 10 | Q | 8 | 43.3 | 24.0 | 12 | 27.7% | 55.5% |
| 10 | H | 8 | 43.3 | 28.0 | 14 | 32.4% | 64.7% |
| 20 | L | 8 | 135.6 | 28.0 | 14 | 10.3% | 20.6% |
| 20 | M | 16 | 67.8 | 26.0 | 13 | 19.2% | 38.3% |
| 20 | Q | 20 | 54.3 | 30.0 | 15 | 27.6% | 55.3% |
| 20 | H | 25 | 43.4 | 28.0 | 14 | 32.3% | 64.5% |
| 25 | L | 12 | 132.3 | 26.0 | 13 | 9.8% | 19.6% |
| 25 | M | 21 | 75.6 | 28.0 | 14 | 18.5% | 37.0% |
| 25 | Q | 29 | 54.8 | 30.0 | 15 | 27.4% | 54.8% |
| 25 | H | 35 | 45.4 | 30.0 | 15 | 33.1% | 66.1% |
| 27 | L | 12 | 152.3 | 30.0 | 15 | 9.8% | 19.7% |
| 27 | M | 25 | 73.1 | 28.0 | 14 | 19.1% | 38.3% |
| 30 | L | 15 | 145.7 | 30.0 | 15 | 10.3% | 20.6% |
| 30 | M | 29 | 75.3 | 28.0 | 14 | 18.6% | 37.2% |
| 33 | L | 18 | 145.1 | 30.0 | 15 | 10.3% | 20.7% |
| 33 | M | 35 | 74.6 | 28.0 | 14 | 18.8% | 37.5% |
| 40 | L | 25 | 148.2 | 30.0 | 15 | 10.1% | 20.2% |
| 40 | M | 49 | 75.6 | 28.0 | 14 | 18.5% | 37.0% |
| 40 | Q | 68 | 54.5 | 30.0 | 15 | 27.5% | 55.0% |
| 40 | H | 81 | 45.8 | 30.0 | 15 | 32.8% | 65.6% |

Two numbers people confuse:
- **EC overhead** — the fraction of the symbol spent on parity: **L ≈ 20%, M ≈ 37%, Q ≈ 55%, H ≈ 66%**.
- **Recovery capacity** — the fraction of codewords that can be wrong and still decode:
  **L ≈ 10%, M ≈ 19%, Q ≈ 27%, H ≈ 33%** by pure RS arithmetic. ISO/IEC 18004's commonly-quoted
  nominal figures (7% / 15% / 25% / 30%) are lower because they reserve misdecode-protection
  codewords and are stated conservatively.

Note the **payload cost is brutal and non-linear**: going L → M costs 21% of your payload; L → H
costs **57%** (v40-L 2953 B → v40-H 1273 B).

### 3.2 What existing animated-QR projects use — universally L

| Project | EC level | Notes |
|---|---|---|
| **txqr** (divan) | **L** | Tested all four levels; L was optimal. *"Low level proved optimal, as it provided only 7% redundancy, resulting in smaller, more readable QR codes that were faster to scan and process."* ([blog](https://divan.dev/posts/animatedqr/)) |
| **txqr + fountain codes** | **L** | Follow-up work found EC level had *"a negligible effect on the result"* once LT codes carried the redundancy ([blog](https://divan.dev/posts/fountaincodes/)) |
| **decimen-optical-transfer** (2026) | **L** | v27 default / v40 optional, EC L, LT fountain codes, 24 fps, measured 129 KB/s ([repo](https://github.com/bashalarmistalt/decimen-optical-transfer/)) |
| **SeedSigner** | **L** | Air-gapped Bitcoin signer, animated QR; uses L, described as *"roughly 7% correction rate"* ([docs](https://github.com/SeedSigner/seedsigner/blob/dev/docs/seed_qr/README.md)) |

### 3.3 Is L defensible? Yes — emphatically, for this channel

**Yes, and it is the correct choice.** The argument:

1. **The screen→camera channel is erasure-dominated, not error-dominated.** Motion blur, glare,
   rolling-shutter tearing and moiré do not sprinkle a few bad modules across an otherwise good
   symbol — they wreck the *whole frame*. A torn frame fails finder-pattern detection or fails the
   format-info BCH check and is discarded outright. A frame that is 40% destroyed is not saved by
   EC level H either. **You lose whole frames, not bits.**
2. **Therefore redundancy belongs at the protocol layer, not the symbol layer.** A fountain code
   (LT / Luby transform, robust soliton degree distribution) over the file gives you rateless,
   order-independent redundancy: the receiver needs any ~`K·1.15` distinct frames and dropped frames
   cost *time*, not *correctness*. This is dramatically more efficient than paying a flat 37% (M) or
   66% (H) tax inside every symbol for protection against a failure mode that doesn't dominate.
3. **Higher EC makes decoding *worse* in the ways that matter.** At fixed physical symbol size,
   raising EC forces a higher version to carry the same payload, which shrinks modules and directly
   attacks the real constraint — camera angular resolution (§4). L keeps modules big.
4. **L still gives ~10% per-block error correction**, which is plenty for the residual failure modes
   that *are* sparse: a specular glare highlight over one corner, a dead pixel, mild JPEG-ish
   compression noise from the camera pipeline.
5. **Empirically, every serious project converged on L** (table above), including two that
   explicitly A/B-tested the levels.

**When you might reach for M:** if you cannot implement a fountain code and are stuck with plain
sequential frames plus retransmission rounds, a little symbol-level EC softens the tail. Also, if
you deliberately push to v40 on a marginal camera, M buys back some margin against the
partially-resolved-module regime. Both are worse designs than "L + fountain codes".

**Q and H are never right here.** They exist for damaged printed labels — a logo overlaid on the
code, a torn sticker, an oily industrial part. None of that describes a glass screen.

---

## 4. Practical decode-reliability limits

### 4.1 The governing constraint: camera pixels per QR module

The Nyquist floor is 2 camera pixels per module; practical decoders need more because the
black/white boundary must survive lens MTF, defocus, sensor demosaic, and the camera's JPEG/H.264
pipeline. The widely-cited working rule is **≥3 px/module bare minimum, ≥4 px/module for
confidence** — below that, module edges blur to grey and the binarizer throws the frame out
([QR sizing analysis](https://barcodepress.com/guides/qr-code-size-guide),
[Uniqode](https://www.uniqode.com/blog/qr-code-best-practices/how-to-perfectly-size-your-qr-codes)).
For a *moving handheld* camera decoding at 15–30 fps, budget **≥5 px/module**.

Crucially, the binding resolution is **not the phone's 48 MP sensor** — it is what `getUserMedia`
actually delivers to the page and what you can process per frame. That is realistically 1280×720 or
1920×1080.

### 4.2 Max QR version vs capture resolution

Assuming the symbol (including its 4-module quiet zone) fills 80% of the capture's short side:

| Capture (short side) | QR spans (80% fill) | @3 px/mod | @4 px/mod | @5 px/mod |
|---|---|---|---|---|
| 480p | 384 px | v25 (117 mod) | v17 (85 mod) | v12 (65 mod) |
| 720p | 576 px | v40 (177 mod) | v29 (133 mod) | v22 (105 mod) |
| **1080p** | **864 px** | **v40 (177 mod)** | **v40 (177 mod)** | **v36 (161 mod)** |
| 1440p | 1152 px | v40 | v40 | v40 |
| 2160p | 1728 px | v40 | v40 | v40 |

Per-version px/module at common capture resolutions:

| Ver | span (+QZ) | 720p @80% (576px) | 1080p @80% (864px) | 1080p @90% (972px) |
|---|---|---|---|---|
| 10 | 65 | 8.86 | 13.29 | 14.95 |
| 15 | 85 | 6.78 | 10.16 | 11.44 |
| 20 | 105 | 5.49 | 8.23 | 9.26 |
| 25 | 125 | 4.61 | 6.91 | 7.78 |
| 30 | 145 | 3.97 | 5.96 | 6.70 |
| 33 | 157 | 3.67 | 5.50 | 6.19 |
| 40 | 185 | 3.11 | 4.67 | 5.25 |

**Answer to "at what version do phone cameras start failing":** at **720p capture, v30 is where it
breaks** (drops below 4 px/module) and v40 is unusable at 3.11. At **1080p capture, v40 is
achievable at 4.67 px/module but has no margin** — any defocus, hand motion, or off-axis framing
pushes it under. **v33 (5.50 px/mod) and v27 (6.50 px/mod) have real headroom.**

### 4.3 Sender side: device pixels per module

The sender must also render modules large enough. Device px per module with the symbol
(+ quiet zone) filling the display's short side:

| Display | Short side (px) | v15 (85) | v20 (105) | v25 (125) | v33 (157) | v40 (185) |
|---|---|---|---|---|---|---|
| Phone 1080×2400 portrait | 1080 | 12.7 | 10.3 | 8.6 | 6.9 | 5.8 |
| Phone 1440×3120 | 1440 | 16.9 | 13.7 | 11.5 | 9.2 | 7.8 |
| Laptop 1920×1080 | 1080 | 12.7 | 10.3 | 8.6 | 6.9 | 5.8 |
| Laptop 2560×1600 | 1600 | 18.8 | 15.2 | 12.8 | 10.2 | 8.6 |
| Laptop 3024×1964 (14" MBP) | 1964 | 23.1 | 18.7 | 15.7 | 12.5 | 10.6 |
| 4K monitor 3840×2160 | 2160 | 25.4 | 20.6 | 17.3 | 13.8 | 11.7 |

The sender is essentially never the bottleneck — even v40 on a 1080p laptop gets 5.8 device px per
module. **But see §6: this must be an *integer* number of device pixels or you get grey fringes.**

### 4.4 Case (a): laptop screen → phone camera

- Sender: 14–16" laptop, symbol ≈ 180 mm square using nearly full screen height.
- Receiver: phone held ~30–45 cm away — comfortably past minimum focus, easy to frame, stable.
- The symbol can genuinely fill 80–90% of the capture frame.
- At 1080p capture: **v40 works at 4.67 px/module but is on the edge. v33 (5.50) is safe. v27 (6.50)
  is comfortable even handheld.**

> **Realistic max for laptop → phone: v33 as the aggressive setting, v40 only with a 1080p+ capture,
> a tripod-steady hand and good focus. Recommended default: v27.**

### 4.5 Case (b): phone screen → phone camera — much tighter

This is the constrained case, and the constraint is **minimum focus distance**, not resolution.

A phone screen is ~70 mm wide. With a typical ~67° horizontal FOV main camera, frame width at
distance *d* is `1.324·d`:

| Distance | Frame width | QR (70 mm) fills |
|---|---|---|
| 66 mm | 87 mm | 80% ← **inside minimum focus, will not focus** |
| 80 mm | 106 mm | 66% |
| **100 mm** | **132 mm** | **53%** ← typical minimum focus distance for a phone main camera |
| 120 mm | 159 mm | 44% |
| 150 mm | 199 mm | 35% |

You physically **cannot** fill the frame with a phone screen using the main camera — you'd have to
be ~6.6 cm away, well inside the ~8–10 cm minimum focus distance. Realistically the symbol occupies
**50–60% of the frame**, not 80%.

px/module at 1080p capture under that reality:

| Ver | span (+QZ) | @50% fill (540 px) | @60% fill (648 px) | (laptop @80%, 864 px) |
|---|---|---|---|---|
| 10 | 65 | 8.31 good | 9.97 good | 13.29 good |
| 15 | 85 | 6.35 good | 7.62 good | 10.16 good |
| 20 | 105 | **5.14 good** | **6.17 good** | 8.23 good |
| 25 | 125 | 4.32 ok | 5.18 good | 6.91 good |
| 27 | 133 | 4.06 ok | 4.87 ok | 6.50 good |
| 30 | 145 | 3.72 marginal | 4.47 ok | 5.96 good |
| 33 | 157 | 3.44 marginal | 4.13 ok | 5.50 good |
| 40 | 185 | 2.92 **FAIL** | 3.50 marginal | 4.67 ok |

> **Realistic max for phone → phone: v20 comfortable, v25 acceptable, v27 the ceiling. v33 and v40
> should be considered broken for this pairing.**

Mitigations if you must go denser phone→phone: use the **ultrawide camera** (many have 3–5 cm macro
focus, at the cost of resolution and barrel distortion), or request a higher `getUserMedia`
resolution and accept a lower processing frame rate.

### 4.6 Frame rate and camera synchronisation

This is as important as version choice and is frequently the actual failure cause.

- **Display rate should be roughly half the camera capture rate.** If the QR changes at the same
  rate the camera exposes, a large fraction of exposures straddle a transition and capture a torn,
  half-old-half-new symbol. At camera 30 fps (33 ms) and QR 15 fps (66 ms), every displayed frame
  contains at least one exposure fully inside its display interval.
- **Rolling shutter guarantees tearing at high QR rates.** A rolling-shutter sensor scans line by
  line, so a mid-exposure display update splits the captured image horizontally
  ([Wikipedia: Rolling shutter](https://en.wikipedia.org/wiki/Rolling_shutter)).
- **PWM/flicker banding.** OLED phone screens dim by PWM; the interaction with rolling shutter
  produces horizontal luminance banding across the captured frame
  ([DXOMARK on temporal light modulation](https://www.dxomark.com/decodes-temporal-light-modulation-and-its-artifacts/)).
  **Mitigation: run the sending screen at maximum brightness**, which usually pushes it into DC
  dimming or a much higher PWM duty cycle, and improves contrast at the same time.
- **LCD pixel response time.** A slow VA/IPS panel takes 5–16 ms grey-to-grey, so at 30 fps QR the
  previous frame ghosts into the next. OLED (~0.03 ms GtG) is far better. Another reason to prefer
  a modest frame rate.
- **Moiré** between the display's pixel grid and the sensor's Bayer grid is real and is best
  defeated by *not* being at a pathological zoom ratio — nudging the framing slightly usually
  clears it.

Prior-art frame rates: txqr found **6–7 fps optimal in 2018** with 12 fps as the aggressive edge
([divan](https://divan.dev/posts/animatedqr/)); with fountain codes it moved to **15 fps**
([divan](https://divan.dev/posts/fountaincodes/)); decimen (2026) uses **24 fps** with
`requestVideoFrameCallback` and a WASM decoder
([repo](https://github.com/bashalarmistalt/decimen-optical-transfer/)). The gap is explained by
better phones, `requestVideoFrameCallback`, WASM decoders, and fountain codes making dropped frames
free.

On the receive side, use
[`HTMLVideoElement.requestVideoFrameCallback()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
rather than `requestAnimationFrame` — it fires once per *actual video frame* with metadata, so you
never decode the same camera frame twice or silently miss one. Caveat: Firefox has historically
throttled rVFC to 40 ms intervals, capping it at 25 fps
([bug 1935256](https://bugzilla.mozilla.org/show_bug.cgi?id=1935256)).

### 4.7 Achievable throughput

Byte mode, EC L, 12-byte frame header, LT fountain overhead 1.15×:

| Ver/EC | payload B/frame | fps | goodput | 100 KB | 1 MB | 10 MB |
|---|---|---|---|---|---|---|
| v15-L | 508 | 10 | 4.3 KB/s | 23.2 s | 4.0 min | 39.6 min |
| v15-L | 508 | 15 | 6.5 KB/s | 15.5 s | 2.6 min | 26.4 min |
| v20-L | 846 | 10 | 7.2 KB/s | 13.9 s | 2.4 min | 23.8 min |
| **v20-L** | **846** | **15** | **10.8 KB/s** | **9.3 s** | **1.6 min** | 15.8 min |
| v25-L | 1261 | 15 | 16.1 KB/s | 6.2 s | 63.8 s | 10.6 min |
| **v27-L** | **1453** | **15** | **18.5 KB/s** | **5.4 s** | **55.3 s** | **9.2 min** |
| v27-L | 1453 | 24 | 29.6 KB/s | 3.4 s | 34.6 s | 5.8 min |
| v33-L | 2056 | 15 | 26.2 KB/s | 3.8 s | 39.1 s | 6.5 min |
| v40-L | 2941 | 15 | 37.5 KB/s | 2.7 s | 27.3 s | 4.6 min |
| v40-L | 2941 | 24 | 59.9 KB/s | 1.7 s | 17.1 s | 2.8 min |

Sanity check against reality: decimen reports **129 KB/s handheld** at v27/24 fps, which is well
above my v27@24fps estimate of 29.6 KB/s. Their figure appears to assume ~every frame decodes at
full rate on a high-end phone. Treat **15–30 KB/s as the realistic planning number** and anything
above as upside. screenferry is a **"a few hundred KB in under a minute"** tool, not a bulk transport.

---

## 5. JavaScript QR generation libraries

All libraries below were **installed and benchmarked locally**, not read about. Hardware:
**Intel Core i5-13500**, node v20.19.2 (V8 — same engine class as Chrome, so timings transfer to
desktop browsers; assume **3–5× slower on a mid-range phone**).

Two independent benchmark runs were performed (different harnesses, different iteration counts,
different payload sets). They agree within ~5% on every shared library — e.g. node-qrcode v40
auto-mask 7.05 vs 7.12 ms, qrcode-generator v40 37.89 vs 38.11 ms, @nuintun v40 18.44 vs 19.59 ms.
The tables below use the more complete run.

### 5.1 Comparison

| Library | Version | License | min | **min+gzip** | Byte mode w/ arbitrary bytes | Module matrix API | Worker-safe | Mask pin |
|---|---|---|---|---|---|---|---|---|
| [fuqr](https://www.npmjs.com/package/fuqr) | 2.1.1 | MIT | 5.9 KB | **2.9 KB** | Yes — via custom `Encoder` | Flat `Uint8Array` | Yes | Fixed (no scoring) |
| [uqr](https://www.npmjs.com/package/uqr) | 0.1.3 | MIT | 10.2 KB | **3.9 KB** | Via `Array.from(u8)` (full copy) | Nested `boolean[][]` | Yes | Yes |
| [qrcodegen](https://github.com/nayuki/QR-Code-generator) (Nayuki) | 1.8.0 | MIT | 11.6 KB | **4.1 KB** | **Yes — native `makeBytes`** | `getModule(x,y)` | Yes | Yes |
| [@paulmillr/qr](https://www.npmjs.com/package/@paulmillr/qr) | 0.3.0 | MIT/Apache-2.0 | 17.7 KB | 7.1 KB | **NO — UTF-8 only, disqualified** | Nested | Yes | Yes |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | 20.8 KB | **7.6 KB** | Only via latin1 string hack | `isDark(row,col)` | Yes | **No** |
| **[qrcode](https://github.com/soldair/node-qrcode)** (node-qrcode) | 1.5.4 | MIT | 24.8 KB | **9.6 KB** (8.0 via core subpath) | **Yes — native `Uint8Array`, documented** | Flat `Uint8Array` + `.size` | **Yes** | Yes |
| [@nuintun/qrcode](https://github.com/nuintun/qrcode) | 5.0.3 | MIT | 27.4 KB | **9.0 KB** (named imports; 18.7 KB namespace) | Via `encode` hook | `BitMatrix.get(x,y)` | Yes | **No** |
| [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) | 1.9.2 | MIT | 48.6 KB | 14.9 KB | **No** | **No public API** | **No** — throws on construct | No |
| [rxing-wasm](https://www.npmjs.com/package/rxing-wasm) | 0.5.7 | Apache-2.0 | 2.3 MB wasm | **907 KB** | **No** — string only | **No** — returns text bitmap | — | No |
| *(reference: decoder)* [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 | 131 KB | 46.4 KB | n/a — **returns `binaryData`** | n/a | Yes | n/a |

Bundle figures are `esbuild --bundle --minify --format=esm` then `gzip -9`, importing **only the
encode entry point** — they are lower than bundlephobia's whole-package numbers because the
PNG/SVG/canvas renderers tree-shake away.

**Worker safety was tested for real**, not assumed: each library was imported and run inside a
`worker_threads` worker with `document` / `window` / `HTMLCanvasElement` / `Image` / `XMLSerializer`
/ `DOMParser` / `navigator` replaced by throwing getters. All passed **except qr-code-styling**,
which imports fine but **throws `touched global "window"` on `new QRCodeStyling(...)`**.

### 5.2 Encode speed — ms per frame (matrix generation only, no PNG/SVG), EC L, byte mode

**Auto mask** (library scores all 8 masks — the default):

| Library | v10 (271 B) | v20 (858 B) | v25 (1273 B) | v40 (2953 B) |
|---|---|---|---|---|
| **fuqr** \* | **0.035** | **0.129** | **0.181** | **0.436** |
| **node-qrcode** | 0.718 | 2.247 | 3.456 | 7.054 |
| qrcodegen (Nayuki) | 1.787 | 5.311 | 7.814 | 18.314 |
| @nuintun/qrcode | 1.792 | 5.343 | 7.837 | 18.436 |
| uqr | 1.799 | 5.306 | 7.729 | 18.502 |
| qrcode-generator | 3.568 | 10.901 | 15.817 | **37.887** |

\* fuqr contains **no mask-scoring code at all** — it always uses a fixed mask (default 2), so its
"auto" and "pinned" numbers are the same work.

**Pinned mask** (`maskPattern: 2`) — the configuration you actually want:

| Library | v10 | v20 | v25 | v40 |
|---|---|---|---|---|
| **fuqr** | **0.038** | **0.148** | **0.202** | **0.498** |
| **node-qrcode** | 0.093 | 0.400 | 0.562 | **1.531** |
| qrcodegen (Nayuki) | 0.136 | 0.516 | 0.748 | 2.301 |
| uqr | 0.150 | 0.568 | 0.792 | 2.501 |
| qrcode-generator / @nuintun | — no mask API — | | | |

**Alphanumeric mode**, v20 EC L, 1249 chars: fuqr 0.136 ms, node-qrcode 2.246 ms auto / 0.405 pinned,
qrcodegen 7.126 / 0.525, uqr 7.280 / 0.550, @nuintun 8.516, @paulmillr 9.837 / 0.700,
qrcode-generator 11.931.

Full pipeline (encode **+** ImageData fill) for node-qrcode, which is what actually matters:

| Version | auto mask | pinned mask | Single-thread capacity | 1000 frames precomputed in |
|---|---|---|---|---|
| v20 | 2.19 ms | 0.43 ms | 456 fps / 2323 fps | 2.2 s / 0.4 s |
| **v27** | **3.63 ms** | **0.71 ms** | **275 fps / 1413 fps** | **3.6 s / 0.7 s** |
| v40 | 7.34 ms | 1.58 ms | 136 fps / 632 fps | 7.3 s / 1.6 s |

**30 fps is not remotely a problem.** Even at v40 with auto mask on a phone (assume 5× slower →
~37 ms/frame) you'd manage ~27 fps single-threaded; at v27 (~18 ms) you'd manage ~55 fps. Move it to
a Worker with look-ahead and encoder speed disappears as a constraint entirely.

### 5.3 The mask-pattern lever (measured — worth 5–8×)

QR encoding evaluates all **8 mask patterns** and picks the one minimising a penalty score. That
search is the dominant cost. Pinning the mask skips it, and the effect is consistent across every
library that exposes the option:

| Library | v40 auto | v40 pinned | **Speedup** |
|---|---|---|---|
| node-qrcode | 7.054 ms | 1.531 ms | **4.6×** |
| qrcodegen (Nayuki) | 18.314 ms | 2.301 ms | **8.0×** |
| uqr | 18.502 ms | 2.501 ms | **7.4×** |

**This is a bigger lever than library choice** for every library except fuqr (which has no mask
scoring to skip).

**Is pinning safe?** Mask selection exists to avoid patterns that confuse decoders (large same-colour
blocks, finder-pattern lookalikes). For *random-looking* data — which fountain-coded, chunked file
data is — I measured the penalty scores of all 8 masks across 60 random v27 payloads:

- **Best-mask distribution: `8,9,7,13,7,4,3,9`** — essentially uniform. No mask is systematically
  good or bad for random data.
- **Penalty spread between best and worst mask: median 8.3%, p90 12.3%, max 16.4%.**

That is a small spread, and round-trip decoding succeeded for masks auto/0/3/7 at v20/27/33/40
(16/16, §2.4). **Conclusion: pinning is safe for screenferry's data profile.** A tidy refinement is to
*rotate* the mask per frame (`mask = frameIndex % 8`) so no single mask persists across the stream.

That said — **you probably don't need this optimisation.** With Worker-based look-ahead, 3.63 ms is
already free. Keep auto-mask for maximum decode robustness and hold pinning in reserve for
low-end devices or if you ever need to encode a large backlog synchronously.

### 5.4 Correctness cross-validation

Speed claims are worthless without correctness, so two differential tests were run:

- **Bit-identical matrices.** With the same pinned mask, node-qrcode / Nayuki qrcodegen / uqr / fuqr
  produce **byte-for-byte identical matrices** across `{v10, v20, v25, v40} × {mask 0, 2, 5, 7}` —
  **16/16 exact.** fuqr's speed is not from cutting corners; it emits the same symbol.
- **Capacity table agreement.** Binary-searching the maximum accepted byte payload for all
  `{v1,5,10,15,20,25,30,35,40} × {L,M,Q,H}` = 36 combinations, node-qrcode, Nayuki and fuqr agreed on
  **all 36**, and every max-capacity symbol decoded byte-exact. **0 mismatches.** This also
  independently confirms the capacity tables in §1.
- **Binary fidelity.** Payloads containing `0x00`, `0x80–0xFF` and the invalid-UTF-8 sequence
  `C3 28` round-tripped **exact** at v10/v20/v25/v40 full capacity for qrcode, qrcode-generator,
  qrcodegen, @nuintun, uqr and fuqr.

### 5.5 Notes per library

**node-qrcode — the pick.** Accepts a `Uint8Array` directly via the documented segment API, so there
is no latin1 round-trip and no chance of silent UTF-8 mangling:

```js
import QRCode from 'qrcode/lib/core/qrcode.js';   // core subpath: 8.0 KB gzip, no PNG/SVG renderers

const qr = QRCode.create(
  [{ data: bytes, mode: 'byte' }],                // bytes: Uint8Array
  { version: 27, errorCorrectionLevel: 'L' }      // optionally maskPattern: 0
);
const size = qr.modules.size;                     // 125 for v27
const data = qr.modules.data;                     // Uint8Array, 1 byte per module, row-major
const isDark = (x, y) => !!data[y * size + x];
```

> **Trap:** never call `QRCode.create(someString, …)` for binary. It UTF-8-encodes — 16 bytes
> becomes a 24-byte Byte segment, silently. **Always use the segment array with `mode: 'byte'`.**

The `qrcode/lib/core/qrcode.js` subpath import saves 1.6 KB gzip (9,577 → 7,985 B) and avoids
pulling in the PNG/SVG/terminal renderers. The saving is modest because `segments.js` statically
pulls in `dijkstrajs` (5.2 KB) for its segment optimiser regardless. Worker safety verified with DOM
globals booby-trapped.

**fuqr — the fastest thing tested, and a legitimate alternative.** 2.9 KB gzip, zero dependencies,
**3–8× faster than node-qrcode** (0.50 ms at v40 vs 1.53 ms pinned), flat `Uint8Array` matrix,
worker-safe. It emits bit-identical symbols to node-qrcode and Nayuki (§5.4). Its `ByteEncoder`
UTF-8s its input, so you supply your own encoder via the public `Encoder` interface:

```js
import { generateWithEncoder, Module } from 'fuqr';

class RawByteEncoder {
  constructor(bytes) { this.bytes = bytes; }              // Uint8Array, no copy
  bitLen(v) { return 4 + (v < 10 ? 8 : 16) + this.bytes.length * 8; }
  encode(v, push) {
    push(0b0100, 4);                                      // mode 4 = byte
    push(this.bytes.length, v < 10 ? 8 : 16);             // char count indicator
    for (const b of this.bytes) push(b, 8);
  }
}
const qr = generateWithEncoder(new RawByteEncoder(payload),
  { minVersion: 27, maxVersion: 27, minEcl: 0, maxEcl: 0, mask: 2 });  // 0=L 1=M 2=Q 3=H
const n = qr.version * 4 + 17;
const isDark = (x, y) => (qr.matrix[y * n + x] & Module.ON) !== 0;
```

Risks: **34 weekly npm downloads** vs node-qrcode's 20.5 M, and **no mask-penalty scoring at all**
(always a fixed mask). Mitigation: fuqr is a **single MIT file** whose README explicitly sanctions
`"Or simply copy src/fuqr.ts"` — vendor it and the supply-chain/abandonment risk goes away, with the
§5.4 differential tests as your regression suite.

**qrcodegen (Nayuki)** — the canonical reference implementation, 4.1 KB gzip, **native `Uint8Array`
via `QrSegment.makeBytes()`**, clean `getModule(x,y)`. Not on npm officially: compile
`typescript-javascript/qrcodegen.ts` yourself, or use the third-party republish
[`nayuki-qr-code-generator`](https://www.npmjs.com/package/nayuki-qr-code-generator) (MIT, default
export). Pass `boostEcl: false` or it will silently upgrade your EC level. 1.5× slower than
node-qrcode pinned. Excellent as a *validation oracle*.

**uqr** — small (3.9 KB gz) and supports `maskPattern`, but ~1.6× slower than node-qrcode pinned,
needs `Array.from(u8)` (a full copy every frame), returns nested `boolean[][]` (pointer chasing in
the render loop), and offers no way to force alphanumeric mode.

**qrcode-generator** — the classic, 7.6 KB gzip, but **no mask API**, so it is stuck on the slow
8-mask path: **37.9 ms at v40 exceeds the 30 fps budget on a desktop** before you render anything.
Byte mode needs `q.addData(buf.toString('latin1'), 'Byte')`. Matrix via `isDark(row, col)` — note the
**(row, col)** order, transposed from the usual (x, y). **Not viable.**

**@nuintun/qrcode** — modern TypeScript, ships encoder **and** decoder in one package (genuinely
appealing for screenferry), clean `BitMatrix`, and a documented `encode?: (content, charset) => Uint8Array`
hook that is a clean escape hatch for raw bytes. But **no mask API**, so it is locked to ~18.4 ms at
v40, and it had the worst p95/mean spread in the study (24.2 vs 18.4 ms). **Still worth evaluating
for the decoder side.**

**@paulmillr/qr — disqualified.** It cannot represent arbitrary binary. `encodeQR(bytes, …)` throws
`utf8ToBytes expected string, got object`; with `{encoding:'byte'}` and a latin1 string it runs the
input back through `utf8ToBytes`, so 16 input bytes decode back as 24 and full-capacity payloads
overflow. Hard fail on the critical requirement.

**qr-code-styling — wrong tool.** A *styling* wrapper (gradients, dot shapes, logos) over
qrcode-generator. 14.9 KB gzip, **no public module-matrix API** (only `append(el)` / `getRawData()` /
`update()`), it inherits the slowest encoder in the study, and it **throws `window is not defined` in
a Worker at construction**. Its value proposition — pretty branded codes — is actively harmful here:
any styling reduces contrast and decode margin. **Do not use.**

**WASM** — evaluated and rejected for generation. `rxing-wasm` ships a **2.3 MB wasm (907 KB
gzipped)**, takes a JS string with no binary API, and returns a *text bitmap* of `X`/space rather
than a matrix. Other candidates checked: `qrcode-wasm` (abandoned demo), `@nayuki/qrcodegen` /
`qr-wasm` / `qrcodegen-ts` (404 on npm). Note that **fuqr is *not* WASM** despite what search results
suggest — it is hand-optimised pure TypeScript, and it beats what a wasm module would plausibly
achieve after JS↔wasm boundary costs. **For generation, WASM is unnecessary** — pure JS already
exceeds the requirement by ~50×. **WASM remains worth serious evaluation on the *decode* side**,
where the workload is genuinely heavy (full-frame binarization + perspective correction at 30 fps)
and where jsQR's 46 KB gzip and pure-JS speed may not suffice; `zxing-wasm` (zxing-cpp) is what
[decimen](https://github.com/bashalarmistalt/decimen-optical-transfer/) uses.

### 5.6 Precomputation and Worker architecture

- Every library except qr-code-styling is pure computation and **Worker-safe** for the
  matrix-generation path (verified with DOM globals booby-trapped).
- **Recommended:** a Worker that maintains a **look-ahead ring buffer of ~60 encoded frames**,
  posting back `{ frameIndex, size, modules: Uint8Array }` with the `Uint8Array` **transferred**
  (zero-copy) rather than cloned.
- Do **not** precompute the entire stream: with fountain codes the frame sequence is unbounded
  (you keep emitting until the receiver signals success or the user stops). A bounded ring buffer is
  both sufficient and memory-safe.
- **No library supports allocation reuse** across frames (none accepts a caller-supplied buffer) and
  **none supports structured-append** encoding. Allocation pressure is low anyway: ~1.2 KB per encode
  for node-qrcode at v25, ~0.8 KB for fuqr. With transfer semantics, GC is a non-issue.
- **Memory, not time, is the reason not to precompute everything.** 1000 v40 matrices at 177×177 =
  31,329 B each = **31 MB** as `Uint8Array` (250 KB if packed to 1 bit/module). Since a frame encodes
  in 0.5–3.6 ms, just-in-time generation with a small rolling look-ahead strictly dominates.

---

## 6. Rendering for a high, stable frame rate

### 6.1 Canvas vs SVG vs ImageData

**Use canvas 2D. Specifically: build a tiny `ImageData` at 1 pixel per module, `putImageData` it to
an offscreen canvas, then `drawImage` that canvas scaled up with `imageSmoothingEnabled = false`.**

Reasoning:

| Approach | Verdict |
|---|---|
| **SVG** | **No.** A v27 symbol is 15,625 modules. Even with `<rect>` run-length merging you get thousands of DOM nodes re-parsed and re-rastered every frame. SVG re-layout is the single worst option for a per-frame full redraw. |
| **Canvas `fillRect` per module** | **No.** 15,625 `fillRect` calls per frame at 15–30 fps is 234k–469k canvas calls/sec. [MDN's canvas optimisation guide](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) specifically calls out large numbers of small draw calls as the dominant cost. Workable at v10, painful at v27, hopeless at v40. |
| **Canvas `fillRect` per horizontal run** | Acceptable middle ground — merge consecutive dark modules per row. Cuts calls ~3–5×. Still worse than the ImageData path. |
| **`ImageData` at 1 px/module + `drawImage` upscale** | **Yes.** You write exactly `size²` pixels into a `Uint8ClampedArray` (177² = 31,329 pixels ≈ 122 KB at v40 — trivial), one `putImageData`, one `drawImage` with nearest-neighbour scaling. The upscale is GPU-accelerated. This is O(modules) in JS and O(1) in draw calls. |

**Measured on this machine** (Intel i5-13500, node 20 / V8 — the JS cost transfers to browsers;
the draw-call cost does not, which is exactly the point):

| Version | Modules | ImageData fill (JS) | Buffer | Naive `fillRect` calls/frame | …calls/sec @15 fps |
|---|---|---|---|---|---|
| v20 | 9,409 | **0.029 ms** | 37 KB | 9,409 | 141,135 |
| v27 | 15,625 | **0.066 ms** | 61 KB | 15,625 | 234,375 |
| v33 | 22,201 | **0.086 ms** | 87 KB | 22,201 | 333,015 |
| v40 | 31,329 | **0.154 ms** | 122 KB | 31,329 | 469,935 |

The ImageData path costs **under 1% of a 16 ms frame budget even at v40**. The `fillRect` path asks
the browser for up to ~470,000 draw calls per second. There is no contest.

Concretely:

```js
// once, at session start
const off = new OffscreenCanvas(size, size);      // size = 17 + 4*version
const octx = off.getContext('2d');
const img = octx.createImageData(size, size);

// per frame: fill img.data from the module matrix, then
octx.putImageData(img, 0, 0);

// on the visible canvas
ctx.imageSmoothingEnabled = false;                // CRITICAL — nearest neighbour
ctx.drawImage(off, 0, 0, size, size, ox, oy, size*scale, size*scale);
```

### 6.2 The integer-scale rule (this one will bite you)

**`scale` must be an integer number of *device* pixels per module, and the destination origin must
land on an integer device pixel.** If a module maps to, say, 6.37 device pixels, the rasteriser
distributes module edges across pixel boundaries and — even with smoothing disabled — you get
inconsistent module widths (6 px, 6 px, 7 px, 6 px…) and, with smoothing *enabled*, grey fringes
that destroy the binarizer's contrast.

Practical recipe:
1. `dpr = window.devicePixelRatio`
2. Set the canvas backing store to CSS size × dpr, and CSS size accordingly.
3. `scale = Math.floor(availableDevicePx / (size + 8))` — the `+8` reserves the quiet zone.
4. Draw at `scale` exactly; centre the result with integer offsets; fill the surrounding area with
   the light colour so the quiet zone is genuinely quiet.

Also: **render pure `#000` on pure `#fff`.** No CSS filters, no `opacity`, no border-radius, no
box-shadow, no dark-mode inversion. Disable any OS/browser colour management surprises by keeping
the canvas in sRGB.

### 6.3 requestAnimationFrame and refresh sync

- **rAF is not a timer, and its rate is the display's, not yours.** It fires at 60 Hz, 90 Hz, 120 Hz
  or 144 Hz depending on the panel, and on a variable-refresh display it is genuinely variable.
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) is explicit
  that you must use the callback's timestamp argument and never assume a fixed interval.
- **Therefore: drive QR frame advancement off the timestamp, not off a frame counter.** Advance to
  the next symbol only when `timestamp - lastAdvance >= frameIntervalMs`. Otherwise your 15 fps
  becomes 15 fps on a 60 Hz laptop and 30 fps on a 120 Hz phone, silently breaking the
  camera-sync ratio from §4.6.
- **Hold each symbol for an integer number of display refreshes.** On a 60 Hz panel, 15 fps = exactly
  4 refreshes; 12 fps = 5 refreshes; 10 fps = 6 refreshes. Non-integer ratios (e.g. 25 fps on 60 Hz)
  produce beat patterns where some symbols are shown for 2 refreshes and others for 3 — a
  ~50% duration jitter that directly causes missed captures. **Prefer QR rates that divide the
  refresh rate evenly**: on 60 Hz, use 10/12/15/20/30 fps.
- **Budget: at 60 Hz you have ~16 ms per rAF callback for everything.** If encoding takes longer
  than that you miss vsync and the symbol duration jitters. See §5 for whether encoding fits — and
  note the mitigation below.
- **Precompute or offload.** Because our frames are known ahead of time (the file doesn't change),
  the correct architecture is: encode **all** frames up front (or in a rolling look-ahead buffer) in
  a **Web Worker**, transfer the module matrices back as `Uint8Array`s, and let the rAF loop do
  nothing but `putImageData` + `drawImage`. This makes the render loop trivially fast and completely
  decouples frame rate from encoder speed. With fountain codes you generate frames endlessly, so use
  a look-ahead ring buffer (e.g. keep 60 frames queued) rather than encoding everything.
- **Do not use `setInterval`/`setTimeout` for frame advancement** — they are clamped, drift, and are
  throttled hard in background tabs.
- **Request a wake lock** ([`navigator.wakeLock`](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API))
  and go fullscreen. Screen dimming mid-transfer kills contrast; a screensaver kills the transfer.
- **Background-tab throttling**: rAF stops entirely when the tab is hidden. Detect
  `document.visibilitychange` and pause/flag the transfer rather than silently stalling.

### 6.4 Accessibility / safety gotcha — do not ignore this

A full-screen, maximum-contrast black↔white pattern changing 10–30 times per second is, in
accessibility terms, **flashing content**. [WCAG 2.3.1 "Three Flashes or Below Threshold"](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-does-not-violate.html)
prohibits content that flashes more than three times per second unless it stays under the general
flash and red-flash thresholds, or the flashing area is under ~25% of any 10° visual field.

A full-screen animated QR at 15 fps plausibly violates this for photosensitive users. Mitigations:

- **Do not render the QR full-screen edge to edge.** Keep it to a bounded square with a static
  surround — this both helps the area exception and improves camera framing.
- Consecutive QR symbols are ~50% dark on average and differ in only some modules, so the *average
  luminance* change frame-to-frame is small. That is the honest defence, but it depends on not
  having a black splash frame between symbols. **Never insert blank/black frames between symbols.**
- **Show an interstitial warning before starting the animation**, and provide a "slow mode"
  (≤3 fps) option.
- Test with the [PEAT](https://trace.umd.edu/peat/) tool if this ships publicly.

---

## Recommendations for screenferry

### The pick

| Decision | Choice | Why |
|---|---|---|
| **Encoding mode** | **Raw byte mode** (`Uint8Array`, no ECI) | 100% efficient; every alternative loses ≥3%. Viable because screenferry ships its own decoder. |
| **Fallback mode** | **base45 in alphanumeric mode** (RFC 9285) | Costs only 3%; the *only* option that makes the native `BarcodeDetector` fast path usable, since it returns `rawValue` as a string. Build the mode as a swappable parameter from day one. |
| **EC level** | **L** | 20% overhead, ~10% per-block correction. The channel is erasure-dominated; redundancy belongs in a fountain code, not in the symbol. Every prior project that A/B-tested this landed on L. |
| **QR version — desktop profile** | **v27** (125×125) | 6.50 px/module at 1080p capture with 80% fill — real headroom. 1465 B/frame. Matches decimen's independently-chosen default. |
| **QR version — mobile profile** | **v20** (97×97) | 5.14 px/module even at a pessimistic 50% frame fill. Phone→phone is limited by minimum focus distance, not resolution. 858 B/frame. |
| **QR version — aggressive/opt-in** | **v33** (149×149) | 5.50 px/module at 1080p/80%. Reserve v40 for a "tripod mode" — 4.67 px/module has no margin. |
| **Frame rate** | **15 fps default** (60 Hz → exactly 4 refreshes/symbol) | Half of a 30 fps camera capture rate, so every symbol gets one clean exposure. Offer 10 fps (6 refreshes) as the reliable fallback and 20 fps (3 refreshes) as aggressive. Never a rate that doesn't divide the refresh rate. |
| **Protocol redundancy** | **LT fountain codes**, robust soliton, ~1.15× overhead | Rateless and order-independent; dropped frames cost time, not correctness. This is what lets EC level L be correct. |
| **Generation library** | **`qrcode` (node-qrcode) v1.5.4, MIT**, via the `qrcode/lib/core/qrcode.js` subpath, **with `maskPattern` pinned** | 8.0 KB gzip; native documented `Uint8Array` byte-mode segments (no latin1 hack, no UTF-8 trap); flat `Uint8Array` matrix; DOM-free so it runs in a Worker; 20.5 M weekly downloads. At 1.53 ms for a pinned v40 it leaves **93% of a 30 fps budget free**. |
| **Mask pattern** | **Pin it** (`maskPattern: 2`) | Measured **4.6–8× speedup** across every library that exposes it — a bigger lever than library choice. Safe for our data: best-mask distribution across 60 random payloads is uniform (`8,9,7,13,7,4,3,9`) and the penalty spread is only 8.3% median, and all masks round-tripped 16/16. A pinned mask also keeps the visual texture stable frame-to-frame instead of flickering as the optimiser jumps between masks. |
| **Rendering** | **`ImageData` at 1 px/module → `putImageData` → `drawImage` upscale with `imageSmoothingEnabled = false`, integer device-pixel scale** | O(modules) JS, O(1) draw calls, GPU upscale. Never SVG; never per-module `fillRect` at these versions. |
| **Encoding placement** | **Web Worker with a look-ahead ring buffer (~60 frames)** | Fully decouples frame rate from encoder speed; the rAF loop does nothing but blit. |

### Target payload per frame

| Profile | Version | EC | Gross byte capacity | − 12 B header | **Net payload** | @15 fps, ÷1.15 fountain | 1 MB transfer |
|---|---|---|---|---|---|---|---|
| **Mobile** (phone → phone) | v20 | L | 858 B | | **846 B** | **10.8 KB/s** | ~1.6 min |
| **Desktop** (laptop → phone) | **v27** | **L** | **1465 B** | | **1453 B** | **18.5 KB/s** | **~55 s** |
| Aggressive (opt-in) | v33 | L | 2068 B | | 2056 B | 26.2 KB/s | ~39 s |
| Tripod mode (opt-in) | v40 | L | 2953 B | | 2941 B | 37.5 KB/s | ~27 s |

**Headline number: 1453 payload bytes per frame at v27-L, 15 fps → ~18.5 KB/s effective.**

### Frame header layout (12 bytes, inside the byte-mode payload)

```
offset  size  field
  0       1   magic/version nibble + profile nibble   (protocol versioning)
  1       4   LT seed (u32 LE)                        (derives the block subset)
  5       4   file-level identifier / total block count
  9       2   payload length (u16 LE)
 11       1   CRC-8 over bytes 0..10 + payload        (cheap frame-integrity gate)
```

The CRC matters: QR's own EC will occasionally produce a *successful but wrong* decode on a badly
torn frame, and without a payload-level check that garbage gets XOR'd into the fountain decoder and
silently corrupts the file. A per-frame CRC plus a whole-file SHA-256 checked at the end is the
minimum safe design.

### Explicitly rejected

- **base64 in byte mode** — costs 25% and is dominated by base45 in every respect.
- **base32 / z-base-32** — 9% loss for human-transcription robustness we don't need.
- **hex / Bytewords** — 27% loss.
- **EC levels Q and H** — designed for damaged printed labels; they cost 55–66% of payload to defend
  against a failure mode (sparse module damage) that a glass screen doesn't produce.
- **SVG rendering** — thousands of DOM nodes per frame.
- **`setInterval` frame advancement** — clamped, drifts, throttled in background tabs.
- **Full-bleed edge-to-edge QR** — worse for WCAG 2.3.1 and worse for camera framing.
- **`@paulmillr/qr`** — cannot represent arbitrary binary at all (UTF-8 only). Hard fail.
- **`qr-code-styling`** — no matrix API, throws `window is not defined` in a Worker, 14.9 KB, wraps
  the slowest encoder tested.
- **`qrcode-generator`** — no mask API, so 37.9 ms at v40 blows the 30 fps budget on a *desktop*.
- **`rxing-wasm`** — 907 KB gzipped, string-only input, returns a text bitmap not a matrix.

### The close call: fuqr

**[fuqr](https://www.npmjs.com/package/fuqr) is genuinely faster and smaller** — 2.9 KB gzip and
0.50 ms at v40, vs node-qrcode's 9.6 KB and 1.53 ms. It emits **bit-identical symbols** to
node-qrcode and Nayuki across 16 version×mask combinations, agrees on all 36 capacity combinations,
is worker-safe, and hands back a flat `Uint8Array`. It is a serious candidate and I want to record
that clearly rather than bury it.

**I still pick node-qrcode, because the thing fuqr optimises is not our bottleneck.** Behind a Worker
with look-ahead, encoder cost is already free — 1.53 ms of a 33 ms budget. Trading 20.5 M weekly
downloads for 34 to reclaim 1 ms we do not need, plus 6.7 KB against a 46 KB decoder, is not a good
trade. fuqr also requires a hand-written `Encoder` subclass to avoid its `ByteEncoder` UTF-8 trap,
which is exactly the class of subtle bug that corrupts a file transfer silently.

**Switch to fuqr if** profiling on real low-end mobile shows encode cost actually matters, or if
bundle size becomes tight. It is a single MIT file its README invites you to vendor, and the §5.4
differential tests give you a ready-made regression suite for the swap. Keep node-qrcode in the test
suite as the validation oracle either way.

### Open questions to resolve in implementation

1. Measure real end-to-end decode rate on target hardware; the gap between divan's 2018 numbers
   (~1–2 KB/s realistic) and decimen's 2026 claim (129 KB/s) is 50×, and the truth for our stack is
   somewhere in between.
2. Decide whether to ship the `BarcodeDetector` + base45 fast path at all, or go jsQR/zxing-wasm
   only. Benchmark both decoders before committing.
3. Adaptive version selection: start at v20, and if the receiver signals nothing (there is no back
   channel — so this must be user-driven or based on a pre-flight "can you read this?" test symbol).
   A pre-flight handshake screen showing a static test symbol at the candidate version is probably
   the cleanest UX.
4. Confirm the integer-device-pixel scaling actually holds on fractional-DPR displays (Windows at
   125%/150% scaling is the notorious case).
