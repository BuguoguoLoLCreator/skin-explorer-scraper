import os
import json
import time
import redis
import requests
from bs4 import BeautifulSoup
from typing import Dict, List, Set, Optional
from dataclasses import dataclass
from datetime import datetime

# 常量定义
CDRAGON = "https://communitydragon.buguoguo.cn"
SKIN_SCRAPE_INTERVAL = 3600  # 1小时
MIN_SUPPORTED_VERSION = [7, 1]

# 别名映射
ALIASES = {
    "Nunu Bot": "Nunu & Willump Bot"
}

# 忽略的警告
IGNORED_WARNINGS = [
    "Unmasked Kayle",
    "Crimson Akali"
]

# 替换映射
SUBSTITUTIONS = {
    "monkeyking": "wukong"
}

@dataclass
class Champion:
    id: int
    name: str
    alias: str
    key: str

@dataclass
class Skin:
    id: int
    name: str
    isBase: bool = False
    questSkinInfo: Optional[Dict] = None

class Cache:
    def __init__(self):
        self.redis = redis.Redis.from_url(os.getenv('REDIS_URL'))
        self.chunk_size = 120000

    def _chunk_string(self, s: str, size: int) -> List[str]:
        return [s[i:i+size] for i in range(0, len(s), size)]

    async def get(self, key: str, initial=None):
        data = self.redis.get(key)
        if not data:
            return initial
        return json.loads(data)

    async def set(self, key: str, value):
        data = json.dumps(value)
        self.redis.set(key, data)

    def destroy(self):
        self.redis.close()

def parse_patch(s: str) -> List[int]:
    return [int(x) for x in s.split('.')]

def compare_patches(a: List[int], b: List[int]) -> int:
    for i in range(len(a)):
        if a[i] > b[i]:
            return 1
        elif a[i] < b[i]:
            return -1
    return 0

def split_id(id: int) -> List[int]:
    return [id // 1000, id % 1000]

def substitute(thing: str) -> str:
    return SUBSTITUTIONS.get(thing, thing)

def get_data_url(path: str, patch: str = "pbe") -> str:
    return f"{CDRAGON}/{patch}/plugins/rcp-be-lol-game-data/global/zh_cn{path}"

def get_data_url_default(path: str, patch: str = "pbe") -> str:
    return f"{CDRAGON}/{patch}/plugins/rcp-be-lol-game-data/global/default{path}"

async def fetch_with_retry(url: str, retries: int = 3, delay: int = 1000):
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
            }, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"第 {attempt} 次尝试获取 {url} 失败: {str(e)}")
            if attempt < retries:
                print(f"等待 {delay}ms 后重试...")
                time.sleep(delay / 1000)
            else:
                raise Exception(f"获取 {url} 失败，已重试 {retries} 次。")

async def get_latest_champions(patch: str = "pbe") -> List[Champion]:
    data = await fetch_with_retry(get_data_url("/v1/champion-summary.json", patch))
    print(f"[CDragon] [{patch}] 英雄数据(zh_CN)加载完成")
    
    champions = []
    for champ in data:
        if champ['id'] != -1:
            champions.append(Champion(
                id=champ['id'],
                name=champ['name'],
                alias=champ['alias'],
                key=substitute(champ['alias'].lower())
            ))
    
    return sorted(champions, key=lambda x: x.name)

async def get_latest_skinlines(patch: str = "pbe") -> List[Dict]:
    data = await fetch_with_retry(get_data_url("/v1/skinlines.json", patch))
    print(f"[CDragon] [{patch}] 皮肤系列(zh_CN)加载完成")
    
    return sorted(
        [line for line in data if line['id'] != 0],
        key=lambda x: x['name']
    )

async def get_latest_skins(patch: str = "pbe") -> Dict[str, Skin]:
    data = await fetch_with_retry(get_data_url("/v1/skins.json", patch))
    print(f"[CDragon] [{patch}] 皮肤数据(zh_CN)加载完成")
    
    skins = {}
    for id, skin_data in data.items():
        skin = Skin(
            id=int(id),
            name=skin_data['name'],
            isBase=skin_data.get('isBase', False),
            questSkinInfo=skin_data.get('questSkinInfo')
        )
        
        if skin.questSkinInfo:
            base = {k: v for k, v in skin_data.items() if k != 'questSkinInfo'}
            for tier in skin.questSkinInfo['tiers']:
                tier_skin = Skin(**{**base, **tier})
                skins[str(tier_skin.id)] = tier_skin
        
        skins[id] = skin
    
    return skins

async def get_latest_skins_default(patch: str = "pbe") -> Dict[str, Skin]:
    data = await fetch_with_retry(get_data_url_default("/v1/skins.json", patch))
    print(f"[CDragon] [{patch}] 皮肤数据(en_US)加载完成")
    
    skins = {}
    for id, skin_data in data.items():
        if skin_data.get('isBase', False):
            skin_data['name'] = "Original " + skin_data['name']
            
        skin = Skin(
            id=int(id),
            name=skin_data['name'],
            isBase=skin_data.get('isBase', False),
            questSkinInfo=skin_data.get('questSkinInfo')
        )
        
        if skin.questSkinInfo:
            base = {k: v for k, v in skin_data.items() if k != 'questSkinInfo'}
            for tier in skin.questSkinInfo['tiers']:
                tier_skin = Skin(**{**base, **tier})
                skins[str(tier_skin.id)] = tier_skin
        
        skins[id] = skin
    
    return skins

async def get_latest_universes(patch: str = "pbe") -> List[Dict]:
    data = await fetch_with_retry(get_data_url("/v1/universes.json", patch))
    print(f"[CDragon] [{patch}] 宇宙数据(zh_CN)加载完成")
    
    return sorted(
        [universe for universe in data if universe['id'] != 0],
        key=lambda x: x['name']
    )

async def get_latest_patch_data(patch: str = "pbe"):
    return await asyncio.gather(
        get_latest_champions(patch),
        get_latest_skinlines(patch),
        get_latest_skins(patch),
        get_latest_universes(patch),
        get_latest_skins_default(patch)
    )

async def get_added(champions: List[Champion], skinlines: List[Dict], 
                   skins: Dict[str, Skin], universes: List[Dict]):
    old_champions, old_skinlines, old_skins, old_universes, _ = await get_latest_patch_data("latest")
    
    old_skin_ids = set(old_skins.keys())
    old_champion_ids = set(c.id for c in old_champions)
    old_skinline_ids = set(l['id'] for l in old_skinlines)
    old_universe_ids = set(u['id'] for u in old_universes)
    
    return {
        'skins': [id for id in skins.keys() if id not in old_skin_ids],
        'champions': [c.id for c in champions if c.id not in old_champion_ids],
        'skinlines': [l['id'] for l in skinlines if l['id'] not in old_skinline_ids],
        'universes': [u['id'] for u in universes if u['id'] not in old_universe_ids]
    }

async def fetch_skin_changes(champions: List[Champion], skins: Dict[str, Skin], 
                           skins_default: Dict[str, Skin]):
    print("[皮肤版本记录] 开始检查历史皮肤列表")
    
    # 获取所有补丁版本
    patches_data = await fetch_with_retry(f"{CDRAGON}/json")
    patches = [
        parse_patch(entry['name'])
        for entry in patches_data
        if entry['type'] == 'directory' and entry['name'].match(r'^\d+\.\d+$')
    ]
    patches.sort(key=lambda x: -compare_patches(x, [0, 0]))
    
    print(f"[皮肤版本记录] 开始检查 (共 {len(champions)} 个英雄)")
    changes = {}
    
    for i, champion in enumerate(champions, 1):
        champion_changes = await get_skin_art_changes(
            champion, skins, skins_default, patches
        )
        changes.update(champion_changes)
        print(f"[皮肤版本记录] 更新完成 {champion.name} ({i}/{len(champions)})")
    
    print("[皮肤版本记录] 皮肤数据更新完成")
    return changes

async def get_skin_art_changes(champion: Champion, skins: Dict[str, Skin],
                             skins_default: Dict[str, Skin], patches: List[List[int]]):
    changes = {}
    url = f"https://leagueoflegends.fandom.com/wiki/{champion.alias}/LoL/Patch_history?action=render"
    
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
    except Exception as e:
        print(f"[错误] 加载 {champion.name} 的补丁历史失败: {str(e)}")
        return changes
    
    # 获取该英雄的所有皮肤
    champ_skins = {
        skin.name: skin
        for skin in skins_default.values()
        if split_id(skin.id)[0] == champion.id
    }
    
    for dl in soup.find_all('dl'):
        dt = dl.find('dt')
        if not dt or not dt.find('a'):
            continue
            
        title = dt.find('a').get('title', '')
        if not title.startswith('V'):
            continue
            
        patch = parse_patch(title[1:])
        if compare_patches(patch, MIN_SUPPORTED_VERSION) <= 0:
            continue
            
        # 找到下一个补丁版本
        patch_index = next(
            (i for i, p in enumerate(patches) if compare_patches(p, patch) == 0),
            -1
        )
        if patch_index == -1 or patch_index + 1 >= len(patches):
            continue
            
        prev_patch = '.'.join(map(str, patches[patch_index + 1]))
        
        # 查找包含"art"的文本
        for element in dl.find_next_sibling().find_all(text=lambda t: 'art' in t.lower()):
            for link in element.parent.find_all('a'):
                name = link.text.strip()
                if not name:
                    continue
                    
                skin = None
                if name in champ_skins:
                    skin = champ_skins[name]
                elif name.startswith('Original '):
                    skin = champ_skins.get(name[9:])
                elif name in ALIASES:
                    skin = champ_skins.get(ALIASES[name])
                    
                if not skin:
                    if name not in IGNORED_WARNINGS:
                        print(f"匹配不到 {name} ({champion.name})")
                    continue
                    
                if skin.id not in changes:
                    changes[skin.id] = set()
                changes[skin.id].add(prev_patch)
    
    return {
        str(k): sorted(list(v), key=lambda x: -compare_patches(parse_patch(x), [0, 0]))
        for k, v in changes.items()
    }

async def scrape():
    should_rebuild = False
    cache = Cache()
    
    persistent_vars = await cache.get('persistentVars', {
        'lastUpdate': 0,
        'oldVersionString': ''
    })
    
    now = int(time.time())
    
    # 检查补丁版本是否变化
    metadata = await fetch_with_retry(f"{CDRAGON}/pbe/content-metadata.json")
    if metadata['version'] == persistent_vars['oldVersionString']:
        print(f"[CDragon] 版本信息与 ({persistent_vars['oldVersionString']})对比无变动，跳过基础数据更新")
    else:
        # 补丁版本发生变化
        champions, skinlines, skins, universes, skins_default = await get_latest_patch_data()
        added = await get_added(champions, skinlines, skins, universes)
        
        await asyncio.gather(
            cache.set('champions', [c.__dict__ for c in champions]),
            cache.set('skinlines', skinlines),
            cache.set('skins', {k: v.__dict__ for k, v in skins.items()}),
            cache.set('universes', universes),
            cache.set('added', added)
        )
        print("[CDragon] Redis基础数据更新完成")
        should_rebuild = True
    
    if now - persistent_vars['lastUpdate'] < SKIN_SCRAPE_INTERVAL:
        print("[皮肤版本记录] 最近更新数据库时间小于1小时，跳过更新")
        return should_rebuild
    
    if not 'champions' in locals():
        champions, skins, skins_default = await asyncio.gather(
            get_latest_champions(),
            get_latest_skins(),
            get_latest_skins_default()
        )
    
    old_changes = await cache.get('changes', {})
    changes = await fetch_skin_changes(champions, skins, skins_default)
    have_new_changes = old_changes != changes
    
    should_rebuild = should_rebuild or have_new_changes
    
    if have_new_changes:
        await cache.set('changes', changes)
        print("[皮肤版本记录] Redis皮肤版本信息更新完成")
    else:
        print("[皮肤版本记录] 没有新增改动，跳过")
    
    await cache.set('persistentVars', {
        'lastUpdate': now,
        'oldVersionString': metadata['version']
    })
    
    return should_rebuild

async def main():
    should_rebuild = await scrape()
    if should_rebuild:
        deploy_hook = os.getenv('DEPLOY_HOOK')
        if not deploy_hook:
            print("[自动部署] 需要重构但是没有提供 DEPLOY_HOOK 信息")
            return
            
        print("[自动部署] 开始执行重构")
        response = requests.post(deploy_hook)
        job = response.json()['job']
        print(f"构建任务信息 {job['id']}, 状态: {job['state']}")
    else:
        print("[自动部署] 不需要重构")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main()) 