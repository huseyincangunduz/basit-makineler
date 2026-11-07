# Basit Makineler: Çarklar ve Kasnaklar Laboratuvarı

Fizik derslerinde **dişli çarklar**, **eş merkezli (üst üste binen) sistemler**, **düz ve çapraz kasnaklar** ile **çıkrık/yük sistemlerini** etkileşimli olarak anlatmak için geliştirilmiş HTML5 Canvas simülasyonudur.

## Özellikler

- **Orantılı Yarıçaplar ($1r, 2r, 3r, 4r$):** Diş sayıları yarıçapla tam orantılıdır ($12, 24, 36, 48$ diş).
- **Üst Üste Binen (Eş Merkezli) Çarklar ve Kasnaklar:** Bir çarkı başka bir çarkın merkezine sürükleyip bıraktığınızda veya sağ panelden **"+ Dişli / + Kasnak"** butonuna bastığınızda aynı mil üzerine eş merkezli olarak yerleşir ($n_1 = n_2$).
- **Dişli Kenetlenmesi:** Dişliler yan yana yaklaştırıldığında $r_1 + r_2$ mesafesinde otomatik mıknatıslanır ve zıt yönde döner ($n_1 \cdot r_1 = n_2 \cdot r_2$).
- **Düz ve Çapraz Kayış Bağlantıları:** Farklı yarıçaptaki kasnaklar ve çarklar arasına ortak dış teğet (düz kayış) veya ortak iç teğet (çapraz kayış) çizilir.
- **Asılı Yükler ($G$):** Çarklara ip ve yük bağlanarak motor döndüğünde yükün kaç $\pi r$ yükseldiği veya alçaldığı ($h = n \cdot 2\pi r$) kesirli olarak hesaplanır.
- **Kilitlenme Tespiti:** Kapalı bir bağlantı döngüsünde yön veya hız çelişkisi oluşursa sistem otomatik olarak kilitlenme uyarısı verir.

## Çalıştırma ve Derleme (Build)

- **Sunucusuz Doğrudan Çalıştırma:** `index.html` veya tek dosyalık taşınabilir `dist/index.html` dosyasına doğrudan çift tıklayarak tarayıcıda açabilirsiniz.
- **Geliştirme Sunucusu:**
  ```bash
  npm start
  ```
- **Derleme (`dist/` üretimi):**
  ```bash
  ./build.sh
  # veya
  npm run build
  ```
