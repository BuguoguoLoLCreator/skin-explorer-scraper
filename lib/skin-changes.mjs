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

const limit = pLimit(10);
const PATCH_REGEX = /^\d+\.\d+$/;

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        validateStatus: (status) => status < 500,
        timeout: 10000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        },
      });
      return response.data;
    } catch (error) {
      console.error(
        `第 ${attempt} 次尝试获取 ${url} 失败: ${error.message}`
      );
      if (attempt < retries) {
        console.log(`等待 ${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(`获取 ${url} 失败，已重试 ${retries} 次。`);
      }
    }
  }
}

export async function fetchSkinChanges(champions, skins, skinsDefault) {
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
        Object.assign(
          changes,
          await getSkinArtChanges(c, skins, skinsDefault, patches)
        );
        console.log(
          `[皮肤版本记录] 更新完成 ${c.name} (${++i}/${champions.length})`
        );
      })
    )
  );

  console.log("[皮肤版本记录] 皮肤数据更新完成");
  return changes;
}

async function getSkinArtChanges(champion, skins, skinsDefault, patches) {
  const changes = {};
  const champSkins = new Fuse(
    Object.values(skinsDefault).filter(
      (skin) => splitId(skin.id)[0] === champion.id
    ),
    {
      keys: ["name"],
      threshold: 0.1,
    }
  );

  const url = `https://leagueoflegends.fandom.com/wiki/${champion.alias}/LoL/Patch_history?action=render`;

  let $;
  try {
    const html = await fetchWithRetry(url);
    $ = cheerio.load(html, false);
  } catch (error) {
    console.error(`[错误] 加载 ${champion.name} 的补丁历史失败: ${error.message}`);
    return changes;
  }

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
            const name = $(link).text().trim();
            if (!name) return;

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
                  console.error(`匹配不到 ${name} (${champion.name})`);
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
