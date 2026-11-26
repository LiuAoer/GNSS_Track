# ORBIT · 全球卫星轨道与地面观测

以真实公开轨道要素展示五大 GNSS 星座、中国空间站、国际空间站、地球资源与气象遥感卫星的三维轨道及二维星下点轨迹；输入地面经纬度，查询可见卫星及全天观测时段。

## 启动

需要 Node.js 20.19+ 或 22.12+。服务器首次启动需要访问 CelesTrak。

```sh
npm install
npm run dev
```

开发地址默认为 http://localhost:5173。正式运行：

```sh
npm run build
npm start
```

正式地址默认为 http://localhost:4173，可用 `PORT` 环境变量修改。必须运行 Node 服务，不能仅双击 HTML 或单独部署 dist：前端通过同源 `/api/ephemeris` 获取数据。`npm run preview` 也带有数据接口。

## GitHub 更新与版本发布

项目仓库：[LiuAoer/GNSS_Track](https://github.com/LiuAoer/GNSS_Track)。新电脑可先克隆工程：

```sh
git clone https://github.com/LiuAoer/GNSS_Track.git
cd GNSS_Track
npm ci
```

日常修改完成后，用以下命令提交并同步到 GitHub。仓库推送到 `main` 或提交 Pull Request 后会自动运行单元测试、Chrome 浏览器测试和生产构建；也可先在分支上开发，再通过 Pull Request 合并。

```sh
git add -A
git commit -m "描述本次更新"
git push
```

发布新版本前先提交工作区的改动，然后运行对应命令：

```sh
npm run release:patch  # 修复：1.0.0 → 1.0.1
npm run release:minor  # 功能：1.0.0 → 1.1.0
npm run release:major  # 重大改动：1.0.0 → 2.0.0
```

命令会先运行完整测试和构建，通过后更新 `package.json` 与锁文件、创建版本提交和 `vX.Y.Z` 标签，并推送至 GitHub。标签触发 GitHub Actions 再次验证并创建带自动更新说明的 Release。若希望在发布前查看差异，也可手动执行 `npm version patch --no-git-tag-version`，检查后再提交并推送；此方式只改版本号，不自动创建 Release。

## 地面观测查询

从顶部“地面观测”或左侧工具栏的准星按钮打开。输入经度（东正西负）、纬度（北正南负）、海拔（米）、最低仰角、日期及统计时区。初始坐标为北京，最低仰角为 10°，默认北京时间 UTC+8；当前系统时间不依赖浏览器时区解释。日期与时区用于全天统计；“当前可见卫星”始终查询此刻，每 10 秒更新。点击全天滑块、小时格或推荐时段后切换到该日指定时刻。

- 查询独立于主视图筛选，默认勾选五大 GNSS 星座，可选择空间站、地球资源、气象遥感或组合。
- 基于未缩放的 SGP4 位置、格林尼治恒星时及 WGS84 地面坐标，计算方位角（北 0°、东 90°）、仰角及斜距。达到所选最低仰角即计入几何可见数量。
- 天空图中北向上、东向右、圆心为天顶。明细列出名称、NORAD、类别、仰角、方位角、斜距、高度和要素历元；点击卫星可进入对应时刻的轨道视图。查询点在三维地球及二维地图标出。
- 后台 Web Worker 每分钟采样一次，共 1,440 点；给出每小时最少/最多/平均数量及前三个互不重叠的连续 30 分钟时段（先按平均数量、再按最少数量、最后按时间排序）。可导出含 UTC、当地时间、观测条件、分组数量的 CSV。
- 无可推算数据的时段留空；来源缺失、旧缓存或要素过期会提示，结果只覆盖可用目录。超过 14 天停止推算，超过 3 天提示时效风险。推荐只比较可见数量，不评估 DOP、信号质量或定位精度。低轨过境短于一分钟时可能漏采。
- **几何可见不保证实际接收**：未计地形/建筑遮挡、大气折射、频段与接收机兼容性、卫星健康状态。空间站与遥感卫星可见不代表可用 GNSS 接收机接收，也不表示满足光学目视条件或遥感载荷覆盖条件。

## 公开影像检索与下载

顶部“影像产品”或地球工具栏的图层按钮打开免账号查询。支持 SHP ZIP（建议含 .shp / .shx / .dbf / .prj）或 WGS84 GeoJSON 面文件。浏览器本地解析 ZIP，并按 .prj 转为 WGS84；选择来源、日期和整景云量后按多边形相交检索，逐页加载更多结果。

- **Sentinel-2 L2A**：全球陆地区域，真彩色与红绿蓝/近红外通常 10 m，其他波段 20 / 60 m；每个文件按资产元数据标注分辨率。数据来自 Earth Search / AWS Open Data，可匿名下载 GeoTIFF。
- **NAIP**：美国航空摄影，通常 0.6–1 m，按场景元数据标注。与卫星影像区分展示。该来源不提供云量筛选；默认查询 2010 年至今。通过 Planetary Computer 的公开匿名签名接口获取有效下载链接，无需账户。
- 下载与 AOI 相交的**完整影像瓦片**，不保证单景覆盖整个 AOI，也未按边界裁剪。文件可能数百 MB，可在 QGIS 按 AOI 裁剪。目录不含商业亚米级全球影像，公开来源的覆盖与收录时间以实际返回为准。
- 浏览器限制文件大小 25 MB，服务端限制请求 3 MB / 10,000 个坐标点；拒绝跨日期变更线的 AOI，需拆分查询。原文件留在浏览器，仅发送 GeoJSON 面和筛选条件。
- 分页与下载入口在服务进程内保留 30 分钟，服务重启或入口过期后重新搜索。取消、替换 AOI 或改变筛选条件会取消旧请求，避免将旧结果用于新区域。影像查询需要 Node 服务，不能仅部署静态文件。

参考：[Sentinel-2 开放数据](https://registry.opendata.aws/sentinel-2-l2a-cogs/)、[NAIP](https://planetarycomputer.microsoft.com/dataset/naip)。

## 数据来源与边界

服务器从 CelesTrak 获取最新 OMM JSON 通用轨道要素，由 satellite.js 的 SGP4/SDP4 模型推算当前 UTC 时刻位置。**这不是 GNSS 广播星历、精密星历或实时测量遥测**；适用于轨道展示，不用于导航定位。数据可能滞后，更新成功也不意味着要素历元就是当前时刻。

| 星座 | CelesTrak 数据组 |
| --- | --- |
| 北斗 | [beidou](https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=json) |
| GPS | [gps-ops](https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=json) |
| Galileo | [galileo](https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=json) |
| GLONASS | [glo-ops](https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=json) |
| QZSS | [gnss](https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json)，筛选 QZS/QZSS/MICHIBIKI 名称 |
| 中国空间站 | [stations](https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json)，NORAD 48274（CSS / TIANHE） |
| 国际空间站 | 同一 stations 请求，NORAD 25544（ISS / ZARYA） |
| 地球资源 / 遥感 | [resource](https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=json) 完整公开分组，包括 Landsat、Sentinel 等 |
| 气象遥感 | [weather](https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json) 完整公开分组 |

- 空间站共用一次上游请求，以主目标编号展示，不重复计入对接飞船和其他舱段。不同分组的相同 NORAD 编号按最新历元去重；相同历元优先保留先列出的分组，因此分组原始记录数可能高于目录去重总数。遥感目录取自上述公开分类，并非全球遥感卫星的完整清单，也不保证卫星当前在役或影像可公开下载。
- 服务器每小时检查上游，浏览器每五分钟同步。手动同步遵守缓存周期；失败至少五分钟后重试。
- 成功获取的数据缓存于 `.cache/ephemeris.json`，支持重启恢复；部分上游失败保留对应旧缓存并明确提示。首次无数据时显示失败与重试入口，不生成虚构轨道。
- 数据面板展示每个来源的获取时间、要素历元范围、收录数、错误信息和原始链接。卫星详情显示 NORAD、国际编号、历元、倾角、偏心率和升交点赤经。
- 要素历元距现在超过 14 天的记录不加入展示；距推算时刻超过 14 天也不返回位置。14 天是应用的展示截止阈值，不是精度保证；超过 3 天提示时效风险。
- 卫星数量来自实际返回数据，不代表健康在役数量。北斗三号基本星座为 **3 GEO + 3 IGSO + 24 MEO**；目录包含增补卫星，全部北斗还包含二号与试验星。“北斗仅显示三号卫星”按源名称筛选，不凑齐 30 颗。
- GEO/IGSO 根据实际周期接近恒星日（容差 30 分钟）区分，同步轨道倾角小于 5° 标为近 GEO，其余为 IGSO。LEO 为平均高度大于 0 且不超过 2,000 km；MEO 以平均轨道高度分类。这是可视化分类，不等于官方任务身份。

## 轨道与交互

所有卫星使用各自的轨道要素，不共享人为设定的圆轨道或相位。默认使用紧凑显示：高轨的地心距离缩至真实比例的 **36%**，低轨依据各自近地点保留地表间距，地球大小不变。每条轨道使用一个固定缩放系数 `max(用户比例, (地球场景半径 + 0.18) / 近地点场景半径)`，轨道线、卫星与选中高亮一致。每条轨道的统一线性缩放保留椭圆形状、偏心率、倾角、轨道方向和卫星相位；这是展示缩放，不是真实地球与轨道的距离比例。底部“轨道比例”面板或“显示设置”提供 20–100% 滑块及数值输入，自动紧凑恢复 36% 并按近地点保留地表间距，100% 恢复真实比例。比例在浏览器本地保存。高度、速度、周期与二维星下点不受显示缩放影响。卫星光点大小为便于交互而放大。QZSS 保留偏心率，GEO 保留实际倾角，不强制归零。地球纹理按格林尼治恒星时旋转；SGP4 输出 TEME 坐标，经恒星时转换计算地理经纬度。未加入精密地球定向参数修正。

默认 1× 跟随系统当前时间（请确保系统时钟准确）；暂停、拖动当日 UTC 时间轴或切换倍率进入时间预览，点击“回到实时”恢复。支持 1×、60×、600×、3600×。

三维轨道线采样推算时刻前后各半个轨道周期，每五分钟重采样；位置持续更新。二维选中卫星通常显示前后各 12 小时星下点轨迹（五分钟采样），LEO 改为前后各 1.5 小时（一分钟采样），均跨日期变更线分段，可观察 GEO 的小范围漂移、IGSO 的“8”字及 QZSS 的不对称轨迹。

拖动旋转、滚轮缩放、点击光点选择卫星；侧栏按导航、空间站、遥感分类筛选，每类支持“仅此类”；北斗 GEO / IGSO / MEO 可独立开关或组合；各类下的“单独”按钮仅显示该类北斗卫星，并隐藏其他星座。可叠加“北斗仅显示三号卫星”，数量来自有效数据而非设计数量。三维轨道、卫星光点、选中高亮、二维地图和总数采用相同筛选规则。“显示全部”恢复全部卫星类别和轨道类型，三号筛选保留。目录搜索所有候选，选择隐藏的卫星会启用相应星座与类型；搜索支持 NORAD 编号、卫星名与轨道类型（包括 QZO）。空格暂停/继续，R 重置视角。支持标签、经纬网、PNG 截图、全屏及移动布局。

顶部“卫星参数表”或三维工具栏表格按钮打开全量目录，可按 GNSS 和关键词筛选，并将当前结果导出为 UTF-8 BOM CSV。表格包含 GNSS/国家、卫星名、NORAD 与国际代号、发射年份、OMM 六根数、平均运动、半长轴、周期、轨道高度、当前推算高度/速度/星下点、历元、历元龄、获取时间、轨道圈数、元素集编号、BSTAR、平均运动导数与源数据链接。国际代号仅提供发射年份/批次，精确发射日期未由 OMM 提供时不推测。超过 14 天的卫星仍保留在统计表中并标记不可推算。

地球纹理为 NASA Blue Marble / three-globe 示例资源，存于 `public/textures`；照明为展示照明，不表示实时日照。

## 验证与代码

```sh
npm test
npm run build
```

单元测试覆盖 Vallado SGP4 标准算例、UTC 历元、GEO 地面经度、IGSO 轨迹、QZSS 径向变化、距离比例、过期数据与数据服务缓存/失败。浏览器测试使用本机 Chrome，固定时钟与真实 OMM 快照（`tests/fixtures/ephemeris.json`），测试目录、来源、时间控制、二维轨迹、筛选、PNG、手机布局与失败恢复，不在测试中反复请求上游。

主要文件：`src/data.js` 为计算；`src/OrbitScene.jsx` 为三维与地图；`src/App.jsx` 为界面；`src/GroundObserver.jsx` 为观测面板，`src/visibility.js` 为观测几何与全天统计，`src/visibility.worker.js` 为后台推算，`server/ephemeris.js` 为数据服务；`server/start.js` 为生产入口。技术栈为 React 19、Three.js、Vite、satellite.js 6.0.2 与 Lucide。采用纯 JavaScript 版 satellite.js，避免不需要的 WASM worker 对构建环境的要求。


## 与实际轨道核对

使用每颗卫星自己的六根数（平均运动、偏心率、倾角、升交点赤经、近地点幅角、平近点角）及历元进行 SGP4 推算，不按标称轨道面生成卫星。卫星信息显示近地点幅角和平近点角，便于核对方向和相位。以下是轨道特征核对，具体显示始终由最新公开 OMM 决定：

- **QZSS**：QZO（倾斜同步准天顶轨道）与 GEO 并存。2026-10-19 测试快照有 QZS-2、QZS-4、QZS-1R 三颗 QZO，以及 QZS-3、QZS-6 两颗 GEO；不是对现役总数的硬编码。QZO 倾角约 38–40°、偏心率约 0.075、近地点幅角约 270°，远地点在北半球，每天在北半球停留更久。内部 QZO 仍归 IGSO，界面单独标识。参考：[日本内阁府 QZSS](https://qzss.go.jp/en/overview/services/sv01_what.html)、[卫星技术信息](https://qzss.go.jp/en/technical/qzssinfo/index.html)。
- **GPS**：标称六轨道面、55°、高度约 20,200 km、周期约 11 h 58 min；保留每颗卫星的实测差异。[ESA Navipedia](https://gssc.esa.int/navipedia/index.php/GPS_Space_Segment)
- **Galileo**：标称三轨道面、56°、高度约 23,222 km，快照推算周期约 14 h 05 min。GSAT0201 / GSAT0202（Galileo 5 / 6）位于非标称偏心轨道，倾角约 48.75°、偏心率约 0.169，仍按真实根数绘制。[ESA Navipedia](https://gssc.esa.int/navipedia/index.php/Galileo_Space_Segment)
- **GLONASS**：标称三轨道面、64.8°、高度约 19,100 km、周期约 11 h 16 min；同样保留实测根数差异。[ESA Navipedia](https://gssc.esa.int/navipedia/index.php/GLONASS_Space_Segment)

测试额外覆盖 QZSS 北半球远地点和驻留时间、三颗 QZO 与两颗 GEO 分类、伽利略偏心轨道例外、五大星座方向与相位保留、紧凑显示对真实数据无影响，以及北斗独立/组合筛选、三号叠加、二维/三维切换和比例开关。

新增验证覆盖两座空间站的 NORAD 识别与低轨地表间距、公开遥感目录去重、天顶/地平线/背面解析几何、观测点海拔单位、日期时区边界、过期数据、全天与即时可见数量一致性、推荐时段排序、浏览器 Worker、CSV 1,440 个采样点及手机布局。`tests/fixtures/extended-ephemeris.json` 是 2026-11-23 获取的公开 OMM 测试快照（遥感仅选取部分真实记录以加速测试）；运行中的服务请求完整公开分组。
