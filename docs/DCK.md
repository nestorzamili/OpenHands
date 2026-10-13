# DCK Agentic

DCK Agentic adalah kustomisasi Agent Canvas pada branch `dev`. Konfigurasi deployment berada di [DEPLOYMENT.md](DEPLOYMENT.md); langkah cutover VM existing dan deployment berikutnya berada di [webgen-production-migration.md](webgen-production-migration.md).

## Modul dan penyimpanan

| Modul | Workspace | Hasil |
| --- | --- | --- |
| WebGen | `/projects/webgen/<slug>` | Aplikasi Next.js dengan satu service Compose, dikelola host WebGen control. |
| Research | `/projects/research` | Laporan riset dengan sumber dan tanggal. |
| Analytics | `/projects/analytics` | Analisis data, SQL, visualisasi, dan materi Power BI. |
| Content | `/projects/content` | Artikel, caption, naskah, dan kalender konten. |

Definisi modul dan override bawaan disimpan di workspace `.dck/modules.json`. Assignment Agent Profile disimpan melalui settings server dan dibatasi oleh workspace serta organisasi. Modul tanpa profil valid tidak membuat percakapan baru. Assignment yang dihapus dikirim sebagai tombstone `null`. Kegagalan membaca registry selain file tidak ditemukan memblokir penulisan.

Apps tersemat menggunakan Customize → Apps (`/apps`). Penjadwalan memakai fitur Automations. Skill, MCP, secrets, Files, dan VSCode memakai fitur Canvas yang sudah tersedia. Skill pengguna berada di `/projects/.agents/skills`; sinkronisasi deployment mempertahankan file pengguna dan perubahan lokal.

## Alur WebGen

1. New Project memvalidasi slug dan memulai percakapan pada workspace proyek individual. Scaffold menulis sumber, `.env.example`, Compose, dan `.dck.json`; scaffold tidak menjalankan deployment.
2. Jika memakai Better Auth, dialog owner-seed mengirim kredensial terpisah dari chat. Seed sementara dapat diminta ulang ketika kedaluwarsa. Agent hanya menerima public verification key.
3. Deploy memanggil API host control melalui proxy Canvas. Layanan memvalidasi Compose, membentuk `.env` dari Secret Manager, menjalankan Docker, menunggu readiness, dan memasang route.
4. Preview berada pada domain Canvas: `https://agent.dckautoposting.com/preview/<slug>`. Publish secara eksplisit membangun ulang aplikasi untuk subdomain; Unpublish membangun ulang untuk preview. Satu aplikasi memiliki satu mode aktif.
5. Badge, link, dan metadata lifecycle berasal dari runtime API. Link tampil hanya ketika running. Percakapan dibuka berdasarkan ID yang diklik; pencarian percakapan proyek menyelesaikan pagination sebelum membuat percakapan baru.

Canvas tidak memiliki Docker socket atau hak menulis nginx host. Deploy/Rebuild/Start/Restart mempertahankan publication yang sudah aktif; perubahan mode hanya melalui Publish/Unpublish. Format proyek dan instruksi scaffold dimiliki oleh [web-generator](../workspace/.agents/skills/web-generator/SKILL.md).

## Kontrak dan verifikasi

- [WebGen control](webgen-control.md): konfigurasi layanan, owner-seed, secrets, dan lifecycle.
- [Reliability](webgen-reliability.md): invariant serta pemeriksaan regresi.
- [Assignment Agent Profile](../specs/dck-module-agent-profile-assignments.md): pemilik state dan aturan pembukaan percakapan.
