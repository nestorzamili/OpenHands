# Rencana deployment produksi berikutnya

Target deployment adalah kode terbaru pada branch `dev`. Baseline VM yang terakhir dikonfirmasi adalah `c52c184`; langkah migrasi sekali jalan di bawah harus selesai sebelum aplikasi existing dikelola oleh layanan baru. Runtime memakai format WebGen baru tanpa adapter route lama, alias metadata, deploy lewat chat, atau fallback link localhost.

## Checklist release

1. Selesaikan perubahan pada `dev`, jalankan pemeriksaan di [reliability](webgen-reliability.md), lalu commit dan push revisi yang akan dirilis. Catat SHA lengkap. Pastikan `git ls-files` tidak memuat segmen `node_modules` dan review seluruh staged diff; hindari `git add -f` untuk dependency, secret, atau artefak.
2. Sebelum maintenance, siapkan kode aplikasi, tujuan penyimpanan upload, dan secrets sesuai bagian 1. Tentukan aplikasi mana yang akan memakai preview. Jangan langsung menghilangkan volume atau mengubah auth metadata tanpa menyesuaikan implementasi aplikasi.
3. Saat maintenance, hentikan penulisan aplikasi, ambil backup dan pastikan dapat dipulihkan. Selesaikan pemindahan upload dan penggantian kepemilikan route pada bagian 1–2.
4. Jalankan workflow **DCK Docker** pada `dev`, pilih **build and deploy**, dan pastikan run memakai SHA yang telah dipilih. Workflow default **build only** tidak mengubah VM. Jangan mendorong commit baru pada `dev` di antara pemilihan revisi dan pemicu workflow.
5. Setelah workflow sukses, adopsi skill baru pada migrasi pertama, jalankan verifikasi layanan, lalu Deploy aplikasi yang sudah siap melalui UI. Publish hanya bila memang ingin subdomain.
6. Akhiri maintenance setelah preview, auth, dan upload terbukti bekerja. Simpan backup di luar workspace serta catatan SHA/image yang aktif. Deployment Canvas sukses saja bukan tanda migrasi aplikasi selesai.

Untuk deployment berikutnya setelah cutover selesai, langkah migrasi route, pemindahan data, dan adopsi skill pertama tidak diulang. Tetap review/tes commit, backup, jalankan workflow pada `dev`, verifikasi service, dan Deploy/Rebuild aplikasi hanya bila sumber atau konfigurasi aplikasinya berubah. Deployment Canvas tidak otomatis membangun ulang aplikasi WebGen.

## Kondisi yang sudah terkonfirmasi

| Komponen | Keputusan migrasi |
| --- | --- |
| Canvas `127.0.0.1:8010` | Tetap menjadi ingress domain `agent.dckautoposting.com`. |
| Content `127.0.0.1:8011` | Milik `dck-content-app-1`; jangan gunakan untuk WebGen. |
| Proxy internal WebGen | Gunakan `127.0.0.1:8012`, diteruskan ke port container `18002`. Port ini kosong saat audit. |
| Host control | Deployment mengisi bridge gateway aktual; audit menunjukkan `172.16.0.1`, bukan `172.17.0.1`. |
| PostgreSQL | User `dck`, database Canvas `dck_agentic`, maintenance database `postgres`. |
| Upload aplikasi | `homey_uploads` dan `its_uploads` terpasang pada `/app/public/uploads`; perlu migrasi penyimpanan sebelum Compose baru dapat dipakai. |
| Metadata aplikasi | Tambahkan `authProvider` dan `needsDatabase` secara eksplisit; `ADMIN_*` tidak membuktikan aplikasi memakai Better Auth. |
| nginx | Include preview sudah ada; include published belum ada. Ada site lama untuk `its` dan `low-sugar-lab`. |
| Skill | Hash web-generator di VM sama dengan c52c184; skill baru perlu diadopsi pada migrasi pertama. |

## 1. Persiapkan data dan aplikasi

Sebelum mengganti container aplikasi, buat backup PostgreSQL, konfigurasi `/opt/dck-agentic`, workspace, nginx, dan kedua volume upload. Hentikan penulisan aplikasi selama pengambilan backup data agar database dan file upload konsisten. Simpan backup di luar workspace yang dikelola lifecycle.

Kontrak Compose baru memuat satu service `app`, `container_name: <slug>-app`, port internal `3000`, port host loopback sesuai `.dck.json`, dan jaringan external `dck`. Host mounts, named volumes, dan pengaturan privileged ditolak. Untuk `homey` dan `its`, pindahkan file upload ke penyimpanan eksternal dan ubah aplikasi agar membaca/menulis di sana. Verifikasi file serta referensi database sebelum melepas mount. Menghapus baris `volumes` saja akan memutus akses file; jangan menjalankan `down -v` untuk migrasi ini.

Sesuaikan setiap `.dck.json` dengan field camelCase `authProvider` dan boolean `needsDatabase`. Tandai database berdasarkan aplikasi sebenarnya: audit menemukan `dck_homey` dan `dck_its`. Gunakan `better-auth` hanya bila implementasi auth dan endpoint signed owner-seed sesuai skill baru; auth custom perlu disesuaikan pada aplikasinya, bukan melalui fallback runtime.

Pindahkan secret yang diperlukan ke Settings → Secrets dengan suffix proyek, misalnya `DATABASE_URL_ITS`, `ADMIN_PASSWORD_ITS`, dan `ADMIN_SESSION_SECRET_HOMEY`. Service membentuk ulang `.env` dari `.env.example` dan secret tersebut. Nilai non-secret seperti `SITE_URL` juga harus sesuai alamat deployment. Kredensial first-owner Better Auth diisi melalui dialog owner-seed, bukan Secret Manager.

Untuk preview `its`, pastikan:

- `APP_BASE_PATH=/preview/its` tersedia saat `next build`, melalui build args Docker/Compose.
- Next.js memakai `basePath`; jangan menambahkan `assetPrefix` untuk tujuan yang sama.
- URL API, gambar publik, callback auth, cookie path, dan URL aplikasi mengikuti prefix tersebut.
- `SITE_URL`, bila dipakai aplikasi, menunjuk alamat preview lengkap.

## 2. Ganti kepemilikan route sekali saat cutover

Preview hanya memakai `https://agent.dckautoposting.com/preview/<slug>`. Tidak memerlukan subdomain, DNS, certificate, atau container kedua.

Pertahankan include ini **di dalam server HTTPS Canvas**:

```nginx
include /etc/nginx/dck-apps/preview-*.conf;
```

Untuk mengaktifkan tombol Publish, buat `/etc/nginx/conf.d/dck-webgen.conf` dengan isi berikut. File ini dimuat di HTTP scope melalui include `conf.d/*.conf` yang sudah ada:

```nginx
include /etc/nginx/dck-apps/published-*.conf;
```

Saat cutover aplikasi terkait, keluarkan konfigurasi berikut dari konfigurasi nginx aktif setelah membackup file dan memeriksa target symlink:

- `/etc/nginx/sites-enabled/its.dckautoposting.com`
- `/etc/nginx/sites-enabled/low-sugar-lab.dckautoposting.com`
- `/etc/nginx/dck-apps/its.conf`
- `/etc/nginx/dck-apps/low-sugar-lab.conf`

Jangan menyalin server block lama ke nama `published-*` bila targetnya preview. Route baru dibuat oleh lifecycle service. Periksa `nginx -T` agar tidak ada include langsung atau duplikasi server aplikasi tersebut. Jangan mengubah site content, arcbridge, atau aplikasi lain yang berada di VM yang sama.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Untuk aplikasi yang sedang berpindah langsung ke preview, kosongkan `subdomain` dan `previewPath` menjadi `null` pada metadata saat maintenance, lalu lakukan Deploy setelah aplikasi siap. Service akan menulis `previewPath` setelah readiness dan konfigurasi route berhasil. Untuk aplikasi yang sudah dikelola format baru dan sedang published, gunakan Unpublish; tindakan tersebut membangun ulang image dengan basePath preview.

## 3. Deploy satu paket versi baru

Deploy image, Compose, `scripts/dck-deploy.sh`, host service, dan workspace skill dari revisi `dev` yang sama melalui pipeline yang ada:

```bash
gh workflow run dck-docker.yml --ref dev -f action="build and deploy"
```

Workflow memakai `ghcr.io/<repository-owner>/dck-agentic:sha-<7-karakter-SHA>`. Deploy script membuat virtualenv Python, menginstal dependensi service, memasang systemd unit, menulis gateway dan user PostgreSQL, lalu mengganti Canvas. `.env` diperbarui untuk image dan gateway; kredensial existing, data PostgreSQL, serta sumber proyek tetap dipertahankan. Script tidak memasang include pada site nginx existing atau memigrasikan volume upload.

Pada migrasi pertama, skill sync mempertahankan file existing yang belum tercatat dalam manifest. Ambil skill baru dari `config/skill-update-candidates/skills/web-generator/SKILL.md`, bandingkan dengan workspace, lalu ganti file workspace tersebut setelah backup. Audit mengonfirmasi versi existing belum dimodifikasi. Daftarkan hash file yang sudah diadopsi pada key `skills/web-generator/SKILL.md` di `config/managed-skills.json`; jangan menimpa entry skill lain. Dengan demikian deployment berikutnya memperbarui versi bawaan yang belum diedit pengguna. Kandidat lain perlu ditinjau masing-masing.

## 4. Verifikasi sesudah deploy

```bash
sudo systemctl is-active webgen-control
sudo nginx -t
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8012/api/workspaces
sudo ss -ltnp '( sport = :8010 or sport = :8011 or sport = :8012 or sport = :8769 )'
```

Request tanpa API key ke port `8012` harus menghasilkan `401`. Port tersebut hanya terikat pada loopback. Pastikan layanan content di `8011` tetap sehat.

Di `/opt/dck-agentic`, jalankan `docker compose ps` dan cocokkan `docker inspect dck-agentic-canvas --format '{{.Config.Image}}'` dengan tag SHA workflow. Bila service bermasalah, periksa `sudo journalctl -u webgen-control -n 100 --no-pager` serta `docker compose logs --tail 100 canvas`; jangan membagikan log yang memuat secret.

Login ke Canvas, buka modul WebGen, dan Deploy aplikasi yang telah dimigrasikan. Verifikasi halaman `/preview/its`, nested route, aset, API, login, serta baca/tulis upload. Badge harus mengikuti status container; URL preview hanya muncul ketika running. Status starting/stopped/error/unknown tidak menampilkan link aktif. Deploy tidak meminta domain; Publish adalah pilihan terpisah dan mengganti mode deployment, bukan membuat preview tambahan.

Aktifkan publikasi subdomain hanya bila memang dibutuhkan dan DNS-nya sudah tersedia. Audit mengonfirmasi wildcard certificate, tetapi belum memverifikasi DNS. Migrasi dianggap selesai setelah data aplikasi dan alur auth/upload lolos pemeriksaan; keberhasilan deploy Canvas saja belum membuktikan aplikasi existing sudah sesuai kontrak baru.

## Jika deployment gagal

Hentikan tindakan lifecycle berikutnya dan periksa log layanan yang gagal. Pemulihan image oleh deploy script hanya mengembalikan image Canvas; Compose, service, dan konfigurasi yang telah disalin tidak otomatis dikembalikan. Saat cutover, pulihkan satu paket release yang konsisten dari backup bila perlu kembali ke baseline. Jangan memasangkan image `c52c184` dengan service baru yang memerlukan proxy internal `8012`. Pulihkan database/data hanya bila diperlukan dari backup yang sesuai; jangan menghapus data aktif untuk mencoba ulang deployment.
