# Hexclave deploy image (hexclave.deploy.ts): serves the locally built dist/. The site isn't built
# remotely because optimizing the screenshots to AVIF runs out of memory, or out of time, on the builder.
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 8080
