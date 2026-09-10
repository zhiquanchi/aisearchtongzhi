FROM node:22-alpine AS build
WORKDIR /app
# 国内网络加速,如需官方源删除下一行
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
# 用 npm install 而非 npm ci:lockfile 在 Windows 生成,含其他平台的
# optional 依赖(@parcel/watcher),ci 在 Linux 上会报 EBADPLATFORM
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
