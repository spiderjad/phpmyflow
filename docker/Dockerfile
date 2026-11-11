# Production image: builds the web UI, then serves server/ with Apache + PHP.
FROM node:22-alpine AS web
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY web web
COPY server server
RUN cd web && npm run build

FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql \
 && a2enmod headers \
 && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
COPY --from=web /app/server/ /var/www/html/
RUN rm -f /var/www/html/config.php && chown -R www-data:www-data /var/www/html
EXPOSE 80
