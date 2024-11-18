import pLimit from "p-limit";
import Fuse from "fuse.js";
import cheerio from "cheerio";
import axios from "axios";
import { splitId, parsePatch, comparePatches } from "./helpers.mjs";
import {
  CDRAGON,
  ALIASES,
  IGNORED_WARNINGS,
  MIN_SUPPORTED_VERSION,
} from "../constants.mjs";

const limit = pLimit(5);
const PATCH_REGEX = /^\d+\.\d+$/;

export async function fetchSkinChanges(champions, skins,skinsDefault) {
  console.log(`[皮肤版本记录] 开始检查历史皮肤列表`);
  const patches = (await axios.get(`${CDRAGON}/json`)).data
    .filter(
      (entry) => entry.type === "directory" && entry.name.match(PATCH_REGEX)
    )
    .map((e) => parsePatch(e.name))
    .sort((a, b) => -comparePatches(a, b));
  console.log(`[皮肤版本记录] 开始检查 (共 ${champions.length} 个英雄)`);
  const changes = {};
  let i = 0;
  await Promise.all(
    champions.map((c) =>
      limit(async () => {
        Object.assign(changes, await getSkinArtChanges(c, skins,skinsDefault, patches));
        console.log(
          `[皮肤版本记录] 更新完成 ${c.name} (${++i}/${champions.length})`
        );
      })
    )
  );
  console.log("[皮肤版本记录] 皮肤数据更新完成");
  return changes;
}

/**
 * Parse a champion's Patch History page from Fandom to find which patches had
 * changed skins.
 *
 * https://leagueoflegends.fandom.com/wiki/Aatrox/LoL/Patch_history
 */
async function getSkinArtChanges(champion, skins,skinsDefault, patches) {
  // console.log(`[皮肤版本记录] 开始检查 ${champion.name}`)
  const changes = {};
  const champSkins = new Fuse(
    Object.values(skinsDefault).filter((skin) => splitId(skin.id)[0] === champion.id),
    {
      keys: ["name"],
      threshold: 0.1,
    }
  );

  const $ = cheerio.load(
    (
      await axios.get(
        //修复一处报错，忽略40X报错解决部分新英雄没有历史记录
        `https://leagueoflegends.fandom.com/wiki/${champion.alias}/LoL/Patch_history?action=render`,
        {
          validateStatus: function (status) {
            return status < 500;
          },
        }
      )
    ).data,
    false
  );

  $("dl dt a")
    .toArray()
    .filter((el) => {
      const t = $(el).attr("title"); 
      if (!t.startsWith("V")) return false;

      const split = t.slice(1).split(".");
      if (!split.length === 2) return false;

      const patch = split.map((e) => parseInt(e, 10));
      if (comparePatches(patch, MIN_SUPPORTED_VERSION) <= 0) return false;

      return true;
    })
    .map((x) => {
      const t = $(x).parents("dl"),
        c = t.next(),
        subset = c.find(':contains(" art")');
      if (!subset.length) return;

      const patch = parsePatch(t.find("a").attr("title").slice(1));
      const prevPatch =
        patches[
          patches.findIndex((p) => comparePatches(p, patch) === 0) + 1
        ].join(".");
      subset.each((_, el) => {
        $(el)
          .find("a[href]")
          .each((_, link) => {
            //此处name为类似于 `Goth Annie` 格式的皮肤名字，来源于fandom wiki页面
            const name = $(link).text().trim();
            if (!name) return;

            // console.log(name)
            // 这里使用Fuse.js模糊搜索，将 Goth Annie 传入，匹配结果
            // 如果CDragon数据使用了非英文源，那么将会匹配失败
            // TODO: 考虑自建映射表
            //https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json
            let matches = champSkins.search(name, { limit: 1 });
            if (!matches.length) {
              if (name.startsWith("Original ")) {
                matches = champSkins.search(name.slice(9), { limit: 1 });
              }
              if (ALIASES[name]) {
                matches = champSkins.search(ALIASES[name], { limit: 1 });
              }

              if (!matches.length) {
                if (!IGNORED_WARNINGS.includes(name)) {
                  console.error(
                    `匹配不到 ${name} (${champion.name})`
                  );
                }
                return;
              }
            }
            const skin = matches[0].item;
            changes[skin.id] = new Set([
              ...(changes[skin.id] ?? []),
              prevPatch,
            ]);
          });
      });
    });

  return Object.keys(changes).reduce(
    (obj, key) => ({
      ...obj,
      [key]: [...changes[key]].sort(
        (a, b) => -comparePatches(parsePatch(a), parsePatch(b))
      ),
    }),
    {}
  );
}
