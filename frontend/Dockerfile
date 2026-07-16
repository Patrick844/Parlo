# Parlo frontend — two stages: build with Node, serve static files with nginx.

FROM node:20-alpine AS build
WORKDIR /app

# VITE_API_BASE is baked in at build time (Vite inlines env vars).
ARG VITE_API_BASE=http://localhost:8200
ENV VITE_API_BASE=$VITE_API_BASE

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
