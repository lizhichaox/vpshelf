# VPShelf

A small shelf for your servers. 面向个人、10 台以内 VPS 的轻量总览面板。

Python + SQLite + 原生 HTML/CSS/JavaScript，无前端构建、无 Agent、无需 Redis。

## 已实现

- Bandwagon / AWS Lightsail / 阿里云 ECS / 通用 Linux VPS。
- SSH 采集 CPU 使用率、1/5/15 分钟负载、内存、根分区磁盘、收发速率、运行时间。
- 搬瓦工周期总流量、已用、剩余、重置时间；低于 20% / 10% 颜色提醒。
- Lightsail 实例状态、地区、公网 IP、套餐；ECS 状态、地区、规格、到期时间。
- 服务器搜索、厂商筛选、响应式界面、最近 24 小时 CPU/内存趋势。
- 运行数据默认每 60 秒采集，云 API 默认每 600 秒采集；历史保留 7 天。
- SSH 和云 API 错误独立显示。失败时清空运行指标，保留并标记上次云数据。
- 私有 JSON 配置、环境变量引用、Bearer token 验证、严格 SSH 主机指纹检查。

## 本地运行

需要 Python 3.10+、OpenSSH 客户端；目标服务器需要 Linux + Python 3。

```sh
git clone https://github.com/lizhichaox/vpshelf.git
cd vpshelf
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.local.json
chmod 600 config.local.json
export VPSHELF_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
# 修改 config.local.json，并设置其中引用的环境变量
python3 -m vpshelf.app
```

打开 http://127.0.0.1:8765 ，本机回环地址启动时，控制台会显示面板访问口令；在面板输入该口令。勾选“在此浏览器记住口令”（默认勾选）后，验证成功的口令会保存到当前站点的浏览器 localStorage，刷新页面、重启服务或浏览器后可自动连接。可通过“访问密钥 → 忘记口令”清除；失效口令会自动清除。非回环地址启动时不打印口令。没有配置 AWS/阿里云适配器时可以不安装 requirements.txt，核心服务和搬瓦工只依赖 Python 标准库。

配置中的三个服务器是占位示例，**请替换或删除后启动**。首次启动没有演示数据，指标来自真实采集。使用空列表 `{"servers":[]}` 可以查看空状态界面。

## 私有配置

使用 `config.local.json`（已被 Git 和 Docker 构建上下文排除）。可直接填入密钥，或使用 `env:VARIABLE_NAME` 从进程环境变量读取。不会自动加载 `.env`；Docker Compose 支持通过 `.env` 插值。

- `id`：唯一、稳定，仅字母/数字/下划线/连字符。用于历史关联。
- `name`：显示名称；`region`：可选手动地区，成功取得云信息后更新。
- `provider`：`bandwagon` / `lightsail` / `aliyun` / `generic`。
- `ssh` 和 `cloud` 至少提供一项；可以先只接 SSH，随后再配置云 API。
- `interval`：15～3600 秒；`cloud_interval`：300～86400 秒。
- `token`：本机回环地址可省略。绑定非回环地址必须至少 24 字符。

### SSH

`host` 可以是 IP、域名或 `~/.ssh/config` 中的别名。支持 `user`、`port`、`identity_file`。先在终端连接一次、核对服务器指纹，并完成密钥登录；应用不自动信任新主机、不接受交互式密码。

采集只读取 `/proc` 和根分区容量，无需 root、无需安装 Agent。网络速率取一秒内除 loopback 外所有网卡字节增量；含隧道/虚拟网卡，可能重复统计，**不用于计费**。磁盘指标仅根分区 `/`。

### Bandwagon

在 KiwiVM 获取 VEID 和 API key，分别填入 `cloud.veid`、`cloud.api_key`。调用 `getServiceInfo`。流量采用 API 的 `plan_monthly_data`、`data_counter`，都乘以 `monthly_data_multiplier`，按 GiB/TiB 显示；`data_next_reset` 单独展示，不当作实例到期日。重置周期不是固定自然月。

接口地址：https://api.64clouds.com/v1/getServiceInfo
官方接口说明：https://kiwivm.64clouds.com/kiwivm-api.php

### AWS Lightsail

设置 `region`、`instance_name`。默认使用 boto3 凭据链；也可以提供 `profile`，或 `access_key_id` / `secret_access_key` / `session_token`。示例中的 `profile: default` 需要本机已配置 AWS profile；若仅使用环境变量或实例角色，请删除 `profile`。

最小操作权限：`lightsail:GetInstance`。内存/磁盘/负载来自 SSH，不伪装成 CloudWatch 数据。第一版没有 Lightsail 计费流量余额。

API：https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_GetInstance.html

### 阿里云 ECS

设置 `region`、`instance_id`、`access_key_id`、`access_key_secret`。建议使用只读 RAM 身份，至少授权 `ecs:DescribeInstances`。第一版使用长期 AccessKey，不支持 STS token。按量付费实例可能没有到期时间。

API：https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describeinstances

## Docker

```sh
docker compose up -d --build
```

须先准备私有配置和环境变量。Compose 默认仅映射本机 8765；数据存储在命名卷。SSH 需要按 compose.yaml 注释挂载专用密钥目录和 `known_hosts`，确保容器 UID 10001 能读取，且私钥权限满足 OpenSSH 要求。容器内私钥路径使用 `/home/shelf/.ssh/...`。配置使用 SSH 别名时也需挂载相应 SSH config。AWS profile 需要额外挂载凭据文件，或删除 profile 改用环境变量。

默认推荐本地运行。远程访问可使用 SSH tunnel；公开部署应置于支持 HTTPS 的认证反向代理后，令牌不要放进 URL。内置 HTTP 服务面向低并发个人使用，不是公共多租户服务。

## 测试

```sh
python3 -m unittest discover -s tests -v
node --check vpshelf/static/app.js
```

测试覆盖计费倍率与超额、采集失败与缓存、历史隔离、SSH 安全选项、配置重复 ID、HTTP 认证和私有路径拒绝。API/SSH 测试使用替身，不连接真实云账户。接入真实账户后应核对首次流量读数与 KiwiVM 面板。

## 目前边界

手动维护服务器清单；不自动发现实例、不写入云资源、不执行重启操作。告警为界面提示，暂不发送邮件或消息。配置修改后需重启。前端刷新只读取缓存，不强制调用云 API。尚未添加开源许可证；公开仓库不等于授予第三方使用许可，许可证由仓库所有者选定。
