# ORBITAL’ı hemen çalıştır — Türkçe başlangıç

Bu ZIP iki şeyi birlikte verir:

1. **Görsel, çalışan bir Next.js başlangıcı:** 3D gece küresi, ISS TLE propagation, ±45 dakikalık iz, geçiş hesabı, fırlatma ve mürettebat panelleri.
2. **Otonom teslim sistemi:** Claude Code lider ajanı, uzman alt ajanlar, hedef kuyruğu, TDD kapıları, bağımsız QA/PR incelemesi ve GitHub squash-merge akışı.

`goals/state.json` yerel ve Git tarafından yok sayılan çalışma hafızasıdır. Kalıcı/public denetim izi PR’lar, CI sonuçları ve commit geçmişidir.
Paketlenirken gerçekten çalıştırılan kontroller ile npm/GitHub/Vercel gerektiren kontroller [`docs/PACKAGE_VALIDATION.md`](./docs/PACKAGE_VALIDATION.md) içinde dürüstçe ayrılmıştır.

## 1. Beş dakikalık yerel başlangıç

```bash
unzip orbital-autonomous-starter.zip
cd orbital

# Gerçek Git kimliğin tanımlı değilse önce bunu yap.
git config --global user.name "Ad Soyad"
git config --global user.email "github-email@example.com"

bash scripts/init-repo.sh
npm run bootstrap
npm run dev
```

Tarayıcıda `http://localhost:3000` açılır. İlk kurulum `package-lock.json` üretir; bunu P1-00 branch/PR’ında commit etmek hedef kuyruğunun ilk işidir.

## 2. GitHub’a çıkar ve PR kurallarını aç

GitHub CLI ile oturum aç:

```bash
gh auth login
gh repo create orbital --public --source=. --remote=origin --push
npm run setup:github
```

`setup:github`; faz/alan etiketlerini, squash/branch-silme ayarlarını ve `goals/roadmap.json` içindeki her hedef için idempotent GitHub issue’larını yayınlar. Issue istemediğin özel bir repo için `npm run setup:github -- --skip-roadmap-issues` kullanılabilir. PR scripti eşleşen issue’yu bulursa PR’a `Closes #…` bağını otomatik ekler.

Repo planın ve yetkin uygunsa `main` korumasını da uygula:

```bash
npm run setup:github -- --protect-main
```

Bu varsayılan, otonom akışı korumak için PR + zorunlu CI + çözülmüş konuşmalar ister; insan onayını zorunlu tutmaz. Her merge öncesi iki bağımsız Claude incelemesi mevcut commit SHA’sına bağlanır. Ayrıca bir insan onayı da zorunlu olsun dersen:

```bash
npm run setup:github -- --protect-main --require-human-review
```

İkinci seçenek otonom merge’i GitHub’da insan onayı gelene kadar bilinçli olarak durdurur. Bu komutlar doğrudan `main` geliştirmesi yapmaz. Sonraki her roadmap hedefi kendi branch ve PR’ına gider, CI’dan geçer, squash merge edilir ve branch silinir.

## 3. Claude Code’u en hızlı biçimde çalıştır

Claude Code’da oturum açılmış olmalı. Paket içindeki `.claude/settings.json` şu davranışları hazır getirir:

- varsayılan ajan: `orbital-lead`
- izin modu: `auto`
- deneysel agent teams açık
- destructive Git/shell işlemlerini engelleyen hook
- görev biterken test kapısı
- aktif hedef yarımken oturumu sürdürmeye çalışan stop gate
- her oturumda roadmap bağlamı

### İzlenebilir interaktif çalışma — önerilen

```bash
npm run claude:auto
```

Lider ajan açılır açılmaz aktif hedefi sürdürür; aktif hedef yoksa Phase 1’de dependency-ready ilk hedefi alır. Ürün tercihi sormaz, en etkileyici ve doğrulanabilir seçeneği seçer. Sadece GitHub/Vercel yetkisi veya gerçek bir credential engeli varsa durur ve blocker kaydeder.

Claude içinden bütün MVP için ölçülebilir hedef de verilebilir:

```text
/goal Phase 1 is complete when every phase-1 objective in goals/roadmap.json is complete, npm run verify exits 0, desktop and mobile Playwright gates pass, and every objective has a merged PR recorded in the local goal ledger.
```

### Tam otomatik hedef döngüsü

Önce MVP’yi bitirip faz sınırında durmak için:

```bash
npm run autopilot -- --phase phase-1
```

Phase 1 → Phase 2 → Phase 3 sırasını, her hedef için ayrı PR/merge şartıyla tek komutta yürütmek için:

```bash
npm run mission
```

`mission`, bir fazın bütün hedefleri GitHub’da merge edilmeden sonraki faza geçmez. P1-07’de gerçek Vercel/GitHub yetkisi eksikse soru yağdırmak yerine blocker kaydedip güvenli biçimde durur.

Bir hedef çalıştırıp kontrol etmek için:

```bash
npm run autopilot -- --phase phase-1 --once
```

Maliyet üst sınırını CLI üzerinden açıkça vermek için:

```bash
npm run autopilot -- --phase phase-1 --max-budget-usd 40
```

Bu döngü bir PR merge edilmeden sonraki hedefi taban almaz. GitHub yetkisi yoksa hedefi `review_ready` bırakır; tamamlandı diye işaretlemez.

## 4. Günlük kontrol komutları

```bash
npm run goals -- status
npm run goals -- next --phase phase-1
npm run doctor
npm run verify
npm run test:e2e -- --project=mobile-375
```

Aktif hedefte RED→GREEN kanıtı (TDD hedeflerinde), objective doğrulama matrisi ve iki bağımsız inceleme kanıtı PR’dan önce zorunludur:

```bash
npm run verify -- --objective P1-03
SHA=$(git rev-parse HEAD)
npm run goals -- review P1-03 --reviewer qa-gatekeeper --verdict APPROVE --sha "$SHA" --summary "no blocking findings"
npm run goals -- review P1-03 --reviewer pr-reviewer --verdict APPROVE --sha "$SHA" --summary "correctness, security and performance clean"
npm run ship:pr -- --objective P1-03
```

Bir doğrulama veya incelemeden sonra commit değişirse rapor/onaylar geçersiz sayılır; objective matrisi ve iki ajan incelemesi yeni HEAD için tekrar çalışmalıdır. Ship kapısı ayrıca branch’in güncel `origin/main` tabanlı ve değişen her dosyanın objective `allowedPaths` sınırında olduğunu kontrol eder.

Normalde lider ajan bunları kendisi yürütür.

## 5. Ajanların iş bölümü

- `orbital-lead`: hedef, branch, entegrasyon ve PR sahibi.
- `orbital-architect`: salt-okunur mimari plan ve risk analizi.
- `propagation-engineer`: TLE, satellite.js, ground track ve güneş/gölge.
- `pass-prediction-engineer`: 72 saat, görünürlük, şehir/GPS.
- `api-platform-engineer`: cache/fallback proxy’leri.
- `globe-visual-engineer`: 3D deneyim, responsive ve animasyon.
- `qa-gatekeeper` + `pr-reviewer`: birbirinden bağımsız son kapı.
- `release-manager`: CI, Vercel ve portfolyo kanıtları.

Yazan ajanlar ayrı worktree kullanır. Ana `node_modules` kurulumu worktree’ye bağlamak için ajan talimatında şu komut hazırdır:

```bash
node scripts/prepare-worktree.mjs
```

## 6. “Bana soru sormasın” sınırı

Paket; renk, komponent yapısı, test düzeni, dosya adı, animasyon seçimi ve geri alınabilir ürün kararlarında soru sormamayı emreder. Şunları varsaymaz:

- GitHub/Vercel hesabının sahibi veya yetkisi
- gerçek deployment URL’si
- gizli token/API anahtarı
- ölçülmemiş Lighthouse/FPS sonucu
- Heavens-Above karşılaştırmasının sonucu

Bunlar yoksa ajan blocker üretir; sahte başarı yazmaz.

## 7. İlk çalıştırmada önerilen sıra

```bash
bash scripts/init-repo.sh
npm run bootstrap
gh repo create orbital --public --source=. --remote=origin --push
npm run setup:github
npm run claude:auto
```

Claude açıldığında P1-00’dan başlar. Phase 1 tamamlanmadan Starlink/zaman kontrolüne geçmemesi roadmap dependency’leri ve lider sözleşmesiyle zorlanır.
