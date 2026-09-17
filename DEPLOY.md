# Разворачивание на хостинге

Цель: приложение живёт на своём домене по HTTPS, ставится на экран iPhone и
работает годами без обслуживания.

**HTTPS обязателен.** Без него Safari не даст поставить приложение на экран
«Домой» и не включит работу офлайн. Поэтому нужен домен, а не голый IP.

---

## Что выбрать из хостинга

Нужен обычный VPS. Требования скромные: **1 ядро, 1 ГБ памяти, 10 ГБ диска** —
приложение однопользовательское, база за годы не вырастет больше нескольких
десятков мегабайт.

Важно, чтобы хостинг был **российским** — тогда не будет истории с блокировками,
из-за которой в прошлом проекте пришлось городить прокси. Подходят Timeweb Cloud,
Selectel, Beget, reg.ru. Цена вопроса — 200–400 ₽ в месяц.

Домен можно взять там же или на reg.ru — подойдёт любой, в том числе дешёвый
в зоне `.ru`.

Дальше команды даны для Ubuntu 22.04/24.04.

---

## 1. Подготовка сервера

Подключись по SSH и поставь всё нужное:

```bash
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx curl git ufw

# Node 22 — нужен именно он, в приложении используется встроенный node:sqlite
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v          # должно быть v22.x или новее
```

Закрой всё, кроме SSH и веба:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

## 2. Файлы приложения

```bash
# Отдельный пользователь: сервису не нужны права root
adduser --system --group --home /opt/tonnage tonnage
mkdir -p /opt/tonnage /var/lib/tonnage
```

Залей каталоги `web/` и `server/` в `/opt/tonnage/` — через `git clone`, `scp`
или файловый менеджер панели хостинга. Должно получиться так:

```
/opt/tonnage/web/index.html
/opt/tonnage/server/src/index.js
```

Права:

```bash
chown -R tonnage:tonnage /opt/tonnage /var/lib/tonnage
```

## 3. Пароль

```bash
cd /opt/tonnage/server
sudo -u tonnage node --no-warnings src/index.js hash 'придумай-пароль'
```

Команда напечатает строку `TONNAGE_PASSWORD_HASH=scrypt$...`. Создай `.env`:

```bash
sudo -u tonnage tee /opt/tonnage/server/.env > /dev/null <<'EOF'
TONNAGE_PASSWORD_HASH=сюда-вставь-строку-из-команды-выше
PORT=8080
HOST=127.0.0.1
TONNAGE_DATA=/var/lib/tonnage
EOF
chmod 600 /opt/tonnage/server/.env
chown tonnage:tonnage /opt/tonnage/server/.env
```

`HOST=127.0.0.1` означает, что сервер не торчит наружу напрямую — снаружи он
доступен только через nginx по HTTPS.

Сгенерируй иконки:

```bash
sudo -u tonnage node /opt/tonnage/server/src/make-icons.js
```

## 4. Автозапуск

```bash
cp /opt/tonnage/server/deploy/tonnage.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tonnage
systemctl status tonnage        # должно быть active (running)
curl -s localhost:8080/api/health
```

Сервис перезапускается сам при падении и стартует после перезагрузки сервера.

## 5. Домен и HTTPS

Направь A-запись домена на IP сервера, подожди несколько минут, затем:

```bash
cp /opt/tonnage/server/deploy/nginx.conf /etc/nginx/sites-available/tonnage
sed -i 's/ТВОЙ-ДОМЕН/примерный-домен.ru/g' /etc/nginx/sites-available/tonnage
ln -sf /etc/nginx/sites-available/tonnage /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

certbot --nginx -d примерный-домен.ru     # выпустит сертификат и пропишет пути
nginx -t && systemctl reload nginx
```

Certbot сам продлевает сертификат — отдельно об этом помнить не нужно.

Проверь: `https://примерный-домен.ru` должен открыть экран входа.

## 6. Установка на iPhone

1. Открой адрес в **Safari** (именно в Safari — из других браузеров iOS не ставит).
2. Кнопка «Поделиться» → **«На экран „Домой"»**.
3. Запусти с иконки, введи пароль один раз.

Дальше приложение открывается без адресной строки и работает в зале без связи.
Записи уходят на сервер, когда интернет возвращается.

---

## Обслуживание

**Обновление приложения:**

```bash
cd /opt/tonnage && git pull          # или залей файлы заново
systemctl restart tonnage
```

Телефон подхватит новую версию сам: оболочка отдаётся с `no-cache`, поэтому
обновление доезжает при следующем запуске.

**Резервная копия.** База — один файл. Копируй каталог целиком:

```bash
systemctl stop tonnage
tar czf /root/tonnage-$(date +%F).tar.gz /var/lib/tonnage
systemctl start tonnage
```

Или, не останавливая сервис, из самого приложения: «Ещё → Скачать копию».
Файл можно потом загрузить обратно кнопкой «Восстановить из файла».

Автоматическая копия раз в неделю:

```bash
crontab -e
# добавить строку:
0 4 * * 1 tar czf /root/tonnage-$(date +\%F).tar.gz /var/lib/tonnage
```

**Логи:**

```bash
journalctl -u tonnage -f          # живой поток
journalctl -u tonnage -n 100      # последние 100 строк
```

---

## Если что-то не работает

| Симптом | Куда смотреть |
|---|---|
| Сайт не открывается | `systemctl status tonnage`, затем `nginx -t` |
| Открывается, но «нет связи» в приложении | `curl localhost:8080/api/health` на сервере |
| «Неверный пароль» при правильном пароле | В `.env` попал лишний пробел или кавычки вокруг хеша |
| Не ставится на экран «Домой» | Открыто не в Safari, либо сертификат не выпустился |
| Приложение не обновляется | На телефоне: закрыть из многозадачности и открыть заново |
| Слишком много попыток входа | Встроенное ограничение, 15 минут; снимается перезапуском сервиса |

**Забыл пароль.** Сгенерируй новый хеш командой из шага 3, замени строку в `.env`
и `systemctl restart tonnage`. Дневник при этом не теряется — он в базе, а не
привязан к паролю.
