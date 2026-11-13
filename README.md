# Домовой – городской портал коммунальных услуг (учебный проект)

Курсовой проект по предмету «Инструменты разработки веб-ресурсов», гр. ВР311.
Стек: HTML5, SCSS → CSS3, JavaScript (DOM), XML (папка `data/`), SVG (карта, иконки, логотип), Figma.

## Запуск

    npm install
    npm run build      # SCSS → css/main.css (или npm run build:fallback без зависимостей)
    npm start          # http://localhost:5173

Открывать нужно через веб-сервер: данные читаются из XML через `fetch`.
Демо-вход в личный кабинет: логин `demo`, пароль `demo2026` (имитация, данные из `data/user.xml`).

## Страницы (ТЗ, раздел 1.2.1)

| Страница | Файл | Данные XML |
|---|---|---|
| Главная: быстрые действия, отключения, новости | `index.html` | `outages.xml`, `news.xml` |
| Подача заявки | `request.html` | `user.xml`, `requests.xml` |
| Статус заявок | `requests.html` | `requests.xml` |
| Отключения и карта (SVG) | `outages.html` | `outages.xml` |
| Тарифы и справка, контакты | `tariffs.html` | `tariffs.xml`, `contacts.xml` |
| Личный кабинет (имитация входа) | `cabinet.html` | `user.xml`, `requests.xml`, `outages.xml` |
| Вспомогательная: ошибка / нет данных | `404.html` | – |

## Контроль качества

- Git Super Linter: `.github/workflows/lint.yml`.
- W3C Markup Validation Service: проверять каждый `.html` вручную на https://validator.w3.org/.
- Публикация: GitHub Pages (`.github/workflows/pages.yml`).

## Дизайн

Правила дизайна, токены, состояния компонентов и критерии доступности: [DESIGN.md](DESIGN.md).

## Макеты

Figma: https://www.figma.com/design/uGvattni8130v6nWTfHDDg
