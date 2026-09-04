# CUTFRAME 积分服务

积分服务使用 Supabase Auth 与 Postgres。前端未配置 Supabase 时会进入明确标注的本地体验模式；体验积分不能作为正式计费依据。

## 启用生产模式

1. 创建 Supabase 项目。
2. 在 SQL Editor 中执行 `migrations/202609040001_cutframe_credits.sql`。
3. 在 Authentication 的 URL Configuration 中添加线上地址：
   `https://mengpingchen954-ops.github.io/merged-asset-tools/cutframe/`
4. 将项目 URL 和公开的 anon key 填入 `cutframe/supabase-config.js`。
5. 在 Authentication Providers 中启用 Email 登录。

`anonKey` 是供浏览器使用的公开密钥；不要把 `service_role` 密钥写入仓库。

## 创建兑换码

兑换码只保存 SHA-256 摘要。以下 SQL 需要在 Supabase SQL Editor 中以管理员身份执行：

```sql
insert into public.redeem_codes (code_hash, points, max_uses, expires_at)
values (
  encode(extensions.digest(upper(trim('CUTFRAME-EXAMPLE')), 'sha256'), 'hex'),
  100,
  1,
  now() + interval '30 days'
);
```

单项透明 PNG 下载消耗 1 积分，整张高清 PNG 固定消耗 2 积分。视频前 30 秒消耗 5 积分，之后每增加 30 秒消耗 3 积分。预览和参数调整免费。
