# DCK Agentic

DCK Agentic adalah kustomisasi Agent Canvas pada branch `dev`. Konfigurasi deployment berada di [DEPLOYMENT.md](DEPLOYMENT.md).

## Modul dan penyimpanan

| Modul | Workspace | Hasil |
| --- | --- | --- |
| WebGen | `/projects/webgen/<slug>` | Aplikasi Next.js dengan satu service Compose, dikelola host WebGen control. |
| Research | `/projects/research` | Laporan riset dengan sumber dan tanggal. |
| Analytics | `/projects/analytics` | Analisis data, SQL, visualisasi, dan materi Power BI. |
| Content | `/projects/content` | Artikel, caption, naskah, dan kalender konten. |

Definisi modul dan override bawaan disimpan di workspace `.dck/modules.json`. Assignment Agent Profile disimpan melalui settings server dan dibatasi oleh workspace serta organisasi. Modul tanpa profil valid tidak membuat percakapan baru. Assignment yang dihapus dikirim sebagai tombstone `null`. Kegagalan membaca registry selain file tidak ditemukan memblokir penulisan.

Apps tersemat menggunakan Customize → Apps (`/apps`). Penjadwalan memakai fitur Automations. Skill, MCP, secrets, Files, dan VSCode memakai fitur Canvas yang sudah tersedia. Skill pengguna berada di `/projects/.agents/skills`; sinkronisasi deployment mempertahankan file pengguna dan perubahan lokal.

### Agent Profile dan migrasi Skills

Modul DCK hanya memilih Agent Profile native; model/provider, tools, verification, serta pemilihan Skills dimiliki profil tersebut, bukan konfigurasi agen kedua di DCK. Workspace, navigasi, dan task starter tetap dimiliki modul. Prompt task tidak lagi ditambahi trigger berdasarkan `skillNames` modul. Nilai lama tetap disimpan tanpa normalisasi nama dan ditampilkan read-only sebagai referensi; membuka atau mengedit modul tidak otomatis mengubah profil yang mungkin digunakan modul lain. Pilih Skills opsional melalui editor Agent Profiles sebelum membuat percakapan baru. Referensi bawaan lama adalah WebGen → `web-generator`, Research → `social-trends-researcher`, Analytics → `data-analytics`, dan Content → `content-creator`; referensi ini bukan bukti bahwa skill tersebut aktif pada profil.

Halaman Skills native (`/skills`) menjadi katalog tunggal, dengan filter Custom, preview built-in, dan authoring custom dari kartu yang dipilih. Editor custom memakai file sumber lengkap, termasuk YAML/frontmatter dan metadata yang tidak dikenali; save/delete tetap memakai file serta scope project/personal yang telah diverifikasi. Membuat atau menyimpan skill tidak otomatis memilihnya untuk profil modul. Tombol Skills global pada halaman native bukan pengganti pemilihan Skills per-profile.

Boundary read/write/delete authoring menolak path di luar root DCK, working directory agent-server, atau home agent-server, serta menolak traversal, URL, dan pergantian backend/organisasi saat resolusi root. Pemeriksaan containment ini bersifat leksikal; typed FileClient saat ini tidak menyediakan verifikasi realpath/symlink. Ini pengaman UI untuk deployment internal tepercaya, bukan sandbox atau pengganti izin filesystem server.

Cloud memiliki transport Agent Profile, tetapi saat ini tidak mendukung pemilihan Skills per-profile maupun authoring file custom dari Canvas. UI menampilkan batasan tersebut; DCK tidak mengemulasinya dengan prompt injection. Katalog dan preview Cloud tetap menggunakan fitur native. Kesetaraan Cloud ini dinilai dari kontrak kode, bukan verifikasi live Cloud; lihat [arsitektur](architecture.md).

## Alur WebGen

1. New Project memvalidasi slug dan memulai percakapan pada workspace proyek individual. Scaffold menulis sumber, `.env.example`, Compose, dan `.dck.json`; scaffold tidak menjalankan deployment.
2. Jika memakai Better Auth, dialog owner-seed mengirim kredensial terpisah dari chat. Seed sementara dapat diminta ulang ketika kedaluwarsa. Agent hanya menerima public verification key.
3. Runtime secrets aplikasi dikelola dari aksi **Environment** pada tiap baris proyek. Nilainya disimpan terenkripsi di host, terpisah dari Agent Secret Manager. Deploy memanggil API host control melalui proxy Canvas; layanan memvalidasi Compose dan menginjeksikan nilai hanya ke service app, lalu menunggu readiness dan memasang route. Menyimpan secret tidak memulai deployment; perubahan berlaku pada Deploy/Rebuild/Start/Restart/Publish/Unpublish berikutnya.
4. Preview berada pada domain Canvas: `https://agent.dckautoposting.com/preview/<slug>`. Publish secara eksplisit membangun ulang aplikasi untuk subdomain; Unpublish membangun ulang untuk preview. Satu aplikasi memiliki satu mode aktif.
5. Badge, link, dan metadata lifecycle berasal dari runtime API. Link tampil hanya ketika running. Percakapan dibuka berdasarkan ID yang diklik; pencarian percakapan proyek menyelesaikan pagination sebelum membuat percakapan baru.

Compose deployment saat ini memasang host `/var/run/docker.sock` ke Canvas sebagai bind mount read-write. Pada deployment tepercaya, supplementary group yang ditemukan di host memberi proses Canvas (termasuk agen dan ACP subprocess yang berjalan lokal) akses Docker efektif; akses daemon ini setara root pada host dan bukan batas keamanan atau sandbox. Socket hanya untuk penggunaan internal tepercaya: jangan membuka Docker TCP, jangan menambahkan izin world-writable, dan jangan memakai konfigurasi ini untuk agen/pengguna yang tidak dipercaya. Mount socket saja tidak membuktikan container dapat mengaksesnya: izin Unix socket/group di host juga menentukan. Canvas tidak diberi hak menulis konfigurasi nginx host; operasi WebGen melewati layanan kontrol host yang tervalidasi, tetapi kontrol itu bukan pengaman terhadap agen yang punya akses Docker. Lihat [Deployment](DEPLOYMENT.md#trusted-internal-docker-access) untuk prosedur dan batas lengkapnya.

Deploy/Rebuild/Start/Restart mempertahankan publication yang sudah aktif; perubahan mode hanya melalui Publish/Unpublish. Format proyek dan instruksi scaffold dimiliki oleh [web-generator](../workspace/.agents/skills/web-generator/SKILL.md).

## Kontrak dan verifikasi

- [WebGen control](webgen-control.md): konfigurasi layanan, owner-seed, secrets, dan lifecycle.
- [Reliability](webgen-reliability.md): invariant serta pemeriksaan regresi.
- [Assignment Agent Profile](../specs/dck-module-agent-profile-assignments.md): pemilik state dan aturan pembukaan percakapan.
