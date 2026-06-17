# VIX + 30-Day IV Alert Dashboard

一个用于监测 VIX、核心标的 30 天隐含波动率、并在出现期权开仓候选时发送邮件提醒的本地仪表板。

## 快速启动

```bash
cp .env.example .env
npm start
```

打开 `http://localhost:8787`。

默认 `DATA_PROVIDER=public`，会使用公开 Yahoo chart/options endpoint 获取 VIX、股价和期权链，并从接近30天到期的ATM call/put估算30天IV。这个模式不需要 token，但公共端点可能限流、变更或短时不可用。

如果只想测试仪表板和邮件逻辑，把 `.env` 里的 `DATA_PROVIDER` 改成 `demo`。如果后续接券商级数据，把它改成 `tradier` 并填入 `TRADIER_TOKEN`。

## 邮件提醒

在 `.env` 中配置：

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SSL=true
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
ALERT_FROM=your_email@gmail.com
ALERT_TO=target_email@example.com
```

Gmail 需要使用 App Password，不要使用网页登录密码。

## 信号逻辑

卖方候选：

- VIX 高于 `VIX_SELL_MIN`
- 标的 IV percentile 高于 `IV_SELL_PERCENTILE_MIN`
- IV 日内/较上一轮有抬升
- 风险未进入 `VIX_RISK_OFF` 以上的明显恐慌区

买方候选：

- VIX 低于 `VIX_BUY_MAX`
- 标的 IV percentile 低于 `IV_BUY_PERCENTILE_MAX`
- IV 没有显著抬升

所有信号只是候选提醒，不是自动下单。实际开仓前仍要复核期权链 bid/ask、财报窗口、宏观事件和标的趋势。

## 线上部署

这个项目是纯 Node 服务，可以部署到 Render、Railway、Fly.io、VPS 或任何支持 Node 的平台。

通用启动命令：

```bash
npm start
```

Render 可直接使用仓库里的 `render.yaml`。Docker 平台可使用 `Dockerfile`。

注意：公共数据源不是正式授权行情接口，适合预警和观察，不适合做券商级实时交易系统。真正下单前仍要在券商端复核价格、IV、bid/ask和成交量。
# vix-iv-alert-dashboard
# vix-iv-alert-dashboard
