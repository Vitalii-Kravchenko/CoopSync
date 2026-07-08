<p align="center">
  <img src="build/logo.svg" width="88" alt="CoopSync">
</p>

<h1 align="center">CoopSync</h1>

<p align="center"><a href="README.md">🇺🇸 English</a> · 🇺🇦 Українська</p>

<p align="center">
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#8A6CFF;background:rgba(138,108,255,.12);border:1px solid rgba(138,108,255,.38);border-radius:5px;">v0.3.1</span>
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#36E2E8;background:rgba(54,226,232,.12);border:1px solid rgba(54,226,232,.38);border-radius:5px;">Windows</span>
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#5AA9FF;background:rgba(90,169,255,.12);border:1px solid rgba(90,169,255,.38);border-radius:5px;">Electron + TS</span>
  <a href="LICENSE"><span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#79839A;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:5px;">Некомерційна</span></a>
</p>

Безкоштовний синхронізатор кооп-сейвів для ігор через приватний GitHub-репозиторій.

## Залежності

- Windows 10 або 11
- Steam (CoopSync визначає встановлені у тебе Steam-ігри)
- **[Git для Windows](https://git-scm.com/download/win)**, встановлений і доступний у
  `PATH` — CoopSync використовує системний Git для push/pull сейвів, він не вбудований
  у застосунок
- Безкоштовний акаунт на [GitHub](https://github.com)

## Ідея

Двоє друзів грають в одну гру — разом (хост + клієнт) або окремо в різний час — і завжди мають
**однакові, найсвіжіші збереження**. Після кожного виходу з гри сейви автоматично вивантажуються на
GitHub; перед запуском — підтягуються найновіші. Жодного Steam Cloud, жодної оплати: один раз логін
у GitHub — і працює.

## Встановлення

> [!WARNING]
> **Windows 11 (версія 22H2 і новіша) може заблокувати встановлення чи запуск CoopSync.**
> Причина — функція **Smart App Control**: вона за замовчуванням вмикається на "чистих" (не
> оновлених зі старіших Windows) інсталяціях Windows 11 22H2+ і блокує будь-які непідписані
> програми, а CoopSync поки що без цифрового підпису.
>
> **Перед встановленням** перевір і, якщо потрібно, вимкни: `Параметри → Конфіденційність і
> безпека → Безпека Windows → Керування додатками та браузером → Smart App Control` → **Вимкнено**.
>
> Це безпечно і не шкодить системі — з оновленням Windows квітня 2026 (KB5083769) функцію можна
> вільно вмикати назад після встановлення, без переустановки Windows.

> [!IMPORTANT]
> **Вимкни Steam Cloud для будь-якої гри, яку синхронізуєш через CoopSync.**
> CoopSync сам керує сейвами ігор, які синхронізує, через власну систему на базі GitHub.
> Якщо Steam Cloud теж синхронізує ту саму папку сейвів — вони можуть конфліктувати й
> перезаписувати зміни одне одного.
>
> У Steam: **Бібліотека → ПКМ на грі → Властивості → Загальне → вимкни «Синхронізація
> Steam Cloud»**.

Завантаж останній `CoopSync-Setup-x.x.x.exe` з [Releases](../../releases) і запусти встановлення —
на першому екрані інсталятора теж буде це саме попередження.

## Як це працює (задум)

1. Обидва встановлюють CoopSync і логіняться в GitHub прямо з програми.
2. Програма створює **приватний** репозиторій і запрошує друга у співавтори.
3. CoopSync працює у фоні (старт разом із Windows), детектить ігри Steam.
4. Закрив гру → сейви пушаться на GitHub. Запускаєш гру → підтягується остання версія.

## Стек

- Electron + TypeScript
- React (UI)
- electron-vite (збірка), electron-builder (інсталятор)

## Скрипти

```bash
npm run dev        # запуск у режимі розробки
npm run build      # збірка
npm run typecheck  # перевірка типів
npm run dist       # зібрати .exe інсталятор
```

## Статус

🚧 У розробці. MVP: логін GitHub → детект Steam-ігор → автосинк сейвів.
