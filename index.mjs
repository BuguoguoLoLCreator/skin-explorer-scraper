import isEqual from "lodash/isEqual.js";
import axios from "axios";
import { cache } from "./lib/cache.mjs";
import { CDRAGON, SKIN_SCRAPE_INTERVAL, SUBSTITUTIONS } from "./constants.mjs";
import { fetchSkinChanges } from "./lib/skin-changes.mjs";

const dataURL = (p, patch = "pbe") =>
  `${CDRAGON}/${patch}/plugins/rcp-be-lol-game-data/global/zh_cn${p}`;

const dataURLDefault = (p) => `${CDRAGON}/pbe/plugins/rcp-be-lol-game-data/global/default${p}`;


const substitute = (thing) => SUBSTITUTIONS[thing] ?? thing;

async function getLatestChampions(patch = "pbe") {
  const { data } = await axios.get(dataURL("/v1/champion-summary.json", patch));
  console.log(`[CDragon] [${patch}] 英雄数据(zh_CN)加载完成`);
  return data
    .filter((d) => d.id !== -1)
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((a) => ({ ...a, key: substitute(a.alias.toLowerCase()) }));
}

async function getLatestUniverses(patch = "pbe") {
  const { data } = await axios.get(dataURL("/v1/universes.json", patch));
  console.log(`[CDragon] [${patch}] 宇宙数据(zh_CN)加载完成`);

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkinlines(patch = "pbe") {
  const { data } = await axios.get(dataURL("/v1/skinlines.json", patch));
  console.log(`[CDragon] [${patch}] 皮肤系列(zh_CN)加载完成`);

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkins(patch = "pbe") {
  const { data } = await axios.get(dataURL("/v1/skins.json", patch));  
  console.log(`[CDragon] [${patch}] 皮肤数据(zh_CN)加载完成`);

  Object.keys(data).map((id) => {
    const skin = data[id];
//注释添加Original+英雄名，此处不用与fandom wiki对比因此无所谓
    // if (skin.isBase) {
    //   skin.name = "Original " + skin.name;
    // }
    if (skin.questSkinInfo) {
      // At the time of writing (12.1), only K/DA ALL OUT Seraphine (147001)
      const base = { ...skin };
      delete base.questSkinInfo;

      skin.questSkinInfo.tiers.map((tier) => {
        const s = { ...base, ...tier };
        data[s.id.toString()] = s;
      });
    }
  });
  return data;
}

// 2024/11/17 
// Fandom Wiki 对比时需要英文皮肤名 Goth Annie

async function getLatestSkinsDefault(patch = "pbe") {
  const { data } = await axios.get(dataURLDefault("/v1/skins.json", patch));  
  console.log(`[CDragon] [${patch}] 皮肤数据(en_US)加载完成`);

  Object.keys(data).map((id) => {
    const skin = data[id];
    if (skin.isBase) {
      skin.name = "Original " + skin.name;
    }
    if (skin.questSkinInfo) {
      // At the time of writing (12.1), only K/DA ALL OUT Seraphine (147001)
      const base = { ...skin };
      delete base.questSkinInfo;

      skin.questSkinInfo.tiers.map((tier) => {
        const s = { ...base, ...tier };
        data[s.id.toString()] = s;
      });
    }
  });
  return data;
}

async function getLatestPatchData(patch = "pbe") {
  return await Promise.all([
    getLatestChampions(patch),
    getLatestSkinlines(patch),
    getLatestSkins(patch),
    getLatestUniverses(patch),
    
    getLatestSkinsDefault(patch),
  ]);
}

async function getAdded(champions, skinlines, skins, universes) {
  const [oldC, oldSl, oldS, oldU] = await getLatestPatchData("latest");
  const oldSkinIds = new Set(Object.keys(oldS)),
    oldChampionIds = new Set(oldC.map((c) => c.id)),
    oldSkinlineIds = new Set(oldSl.map((l) => l.id)),
    oldUniverseIds = new Set(oldU.map((u) => u.id));

  return {
    skins: Object.keys(skins).filter((i) => !oldSkinIds.has(i)),
    champions: champions.map((c) => c.id).filter((i) => !oldChampionIds.has(i)),
    skinlines: skinlines.map((l) => l.id).filter((i) => !oldSkinlineIds.has(i)),
    universes: universes.map((u) => u.id).filter((i) => !oldUniverseIds.has(i)),
  };
}

async function scrape() {
  let shouldRebuild = false;
  const { lastUpdate, oldVersionString } = await cache.get("persistentVars", {
    lastUpdate: 0,
    oldVersionString: "",
  });
  const now = Date.now();

  let champions, skinlines, skins, skinsDefault,universes;

  // Check to see if patch changed.
  const metadata = (await axios.get(CDRAGON + "/pbe/content-metadata.json"))
    .data;
  if (metadata.version === oldVersionString) {
    console.log(
      `[CDragon] 版本信息与 (${oldVersionString})对比无变动，跳过基础数据更新`
    );
  } else {
    // Patch changed!
    [champions, skinlines, skins,universes,skinsDefault] = await getLatestPatchData();
    const added = await getAdded(champions, skinlines, skins, universes);

    await Promise.all([
      cache.set("champions", champions),
      cache.set("skinlines", skinlines),
      cache.set("skins", skins),
      cache.set("universes", universes),
      cache.set("added", added),
    ]);
    console.log("[CDragon] Redis基础数据更新完成");
    shouldRebuild = true;
  }

  if (now - lastUpdate < SKIN_SCRAPE_INTERVAL * 1000) {
    console.log(
      "[皮肤版本记录] 最近更新数据库时间小于1小时，跳过更新"
    );
    return shouldRebuild;
  }

  if (!champions) {
    [champions, skins, skinsDefault] = await Promise.all([
      getLatestChampions(),
      getLatestSkins(),
      getLatestSkinsDefault(),
    ]);
  }
  const oldChanges = await cache.get("changes", {});
  const changes = await fetchSkinChanges(champions, skins,skinsDefault);
  const haveNewChanges = !isEqual(changes, oldChanges);
  shouldRebuild = shouldRebuild || haveNewChanges;

  if (haveNewChanges) {
    await cache.set("changes", changes);
    console.log("[皮肤版本记录] Redis皮肤版本信息更新完成");
  } else {
    console.log("[皮肤版本记录] 没有新增改动，跳过");
  }
  await cache.set("persistentVars", {
    lastUpdate: now,
    oldVersionString: metadata.version,
  });

  return shouldRebuild;
}

async function main() {
  const shouldRebuild = await scrape();
  if (shouldRebuild) {
    if (!process.env.DEPLOY_HOOK)
      return console.log("[自动部署] 需要重构但是没有提供 DEPLOY_HOOK 信息");
    console.log("[自动部署] 开始执行重构");
    const { job } = (await axios.post(process.env.DEPLOY_HOOK)).data;
    console.log(`构建任务信息 ${job.id}, 状态: ${job.state}`);
  } else {
    console.log("[自动部署] 不需要重构");
  }
}

main().then(() => cache.destroy());
