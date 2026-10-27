FROM nginx:1.29-alpine

COPY infrastructure/nginx/nginx.docker.conf /etc/nginx/nginx.conf
COPY infrastructure/nginx/procedure-maintenance.html /usr/share/nginx/html/procedure-maintenance.html
COPY infrastructure/nginx/maintenance-maintenance.html /usr/share/nginx/html/maintenance-maintenance.html
COPY infrastructure/nginx/workspace-maintenance.html /usr/share/nginx/html/workspace-maintenance.html
COPY infrastructure/nginx/hrm-maintenance.html /usr/share/nginx/html/hrm-maintenance.html
COPY infrastructure/nginx/assistant-maintenance.html /usr/share/nginx/html/assistant-maintenance.html
COPY infrastructure/nginx/shared-maintenance.html /usr/share/nginx/html/shared-maintenance.html
COPY infrastructure/nginx/social-maintenance.html /usr/share/nginx/html/social-maintenance.html
COPY infrastructure/nginx/crm-maintenance.html /usr/share/nginx/html/crm-maintenance.html
