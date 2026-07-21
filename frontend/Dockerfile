# Parlo frontend — two stages: build with Node, serve static files with nginx.

FROM node:20-alpine AS build
WORKDIR /app

# VITE_* vars are baked in at build time (Vite inlines env vars).
ARG VITE_API_BASE=http://localhost:8200
ENV VITE_API_BASE=$VITE_API_BASE
# PostHog analytics — blank by default (disabled); set in prod to enable.
ARG VITE_POSTHOG_KEY=
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST=https://eu.i.posthog.com
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
