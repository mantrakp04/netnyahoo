# Hexclave deploy image (hexclave.deploy.ts): serves the locally built dist/. The site isn't built
# remotely because optimizing the screenshots to AVIF runs out of memory, or out of time, on the builder.
FROM nginx:1.29-alpine
# The image renders templates/*.template into conf.d at start, filling ${NGINX_LOCAL_RESOLVERS}
# (the container's own DNS) for the PostHog relay.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY dist /usr/share/nginx/html
EXPOSE 8080
