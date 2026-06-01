# Nginx Examples

Replace `YOUR_DOMAIN`, certificate paths, and local ports for your server.

## Combined HTTPS Server

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name YOUR_DOMAIN;

    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    include /opt/cinema/nginx_cinema.conf.example;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /live/ {
        proxy_pass http://127.0.0.1:8090/live/;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_buffering on;
        proxy_cache off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin * always;
    }

    location /test/ {
        proxy_pass http://127.0.0.1:8090/test/;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_buffering on;
        proxy_cache off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin * always;
    }

    location /api/v1/ {
        proxy_pass http://127.0.0.1:1985/api/v1/;
        proxy_set_header Host $host;
        add_header Access-Control-Allow-Origin *;
    }
}
```
