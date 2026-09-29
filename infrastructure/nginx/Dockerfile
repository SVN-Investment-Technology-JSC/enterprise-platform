FROM nginx:1.29-alpine

COPY infrastructure/nginx/nginx.docker.conf /etc/nginx/nginx.conf
COPY infrastructure/nginx/procedure-maintenance.html /usr/share/nginx/html/procedure-maintenance.html
COPY infrastructure/nginx/maintenance-maintenance.html /usr/share/nginx/html/maintenance-maintenance.html
COPY infrastructure/nginx/workspace-maintenance.html /usr/share/nginx/html/workspace-maintenance.html
COPY infrastructure/nginx/hrm-maintenance.html /usr/share/nginx/html/hrm-maintenance.html
