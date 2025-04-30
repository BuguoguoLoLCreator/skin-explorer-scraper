# Skin Explorer Scraper (Python版本)

这是一个用于从CommunityDragon和英雄联盟Wiki抓取皮肤数据的Python爬虫程序。它会将数据存储在Redis缓存中，供其他应用程序使用。

## 功能特点

- 从CommunityDragon获取英雄、皮肤、皮肤系列和宇宙数据
- 从LOL Wiki获取皮肤历史变更记录
- 将数据存储到Redis缓存
- 定期检查更新并触发重建

## 环境要求

- Python 3.8+
- Redis服务器

## 安装

1. 克隆仓库：
```bash
git clone [repository-url]
cd skin-explorer-scraper
```

2. 安装依赖：
```bash
pip install -r requirements.txt
```

3. 配置环境变量：
创建`.env`文件并设置以下变量：
```
REDIS_URL=redis://localhost:6379
DEPLOY_HOOK=https://your-deploy-hook-url
```

## 使用方法

直接运行主脚本：
```bash
python scraper.py
```

## 数据存储

程序会在Redis中存储以下数据：
- champions: 英雄数据
- skinlines: 皮肤系列数据
- skins: 皮肤数据
- universes: 宇宙数据
- changes: 皮肤变更历史
- added: 新增内容
- persistentVars: 持久化变量

## 注意事项

- 程序默认每小时检查一次更新
- 需要确保Redis服务器正常运行
- 需要配置正确的DEPLOY_HOOK以触发自动部署
