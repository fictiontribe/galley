import { Link } from "react-router-dom";
import { count } from "@/lib/format";
import { Skeleton, buttonClass } from "@/ui";
import "./plugins.css";
import { usePluginList } from "./usePlugins";

/** For Site settings: how many plugins are active for this site, how many it names, and the way to them. */
export function SitePluginsSummary({ siteId }: { siteId: string }) {
  const list = usePluginList(siteId);
  const plugins = list.data?.plugins ?? [];
  const active = plugins.filter((plugin) => plugin.active).length;
  const own = plugins.filter((plugin) => plugin.source === "site").length;
  const broken = plugins.filter((plugin) => plugin.problems.length > 0).length;

  return (
    <section className="app-settings__section" aria-labelledby="site-plugins-title">
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id="site-plugins-title">
          Plugins
        </h2>
        <p className="app-settings__section-text">What plugins add while this site is open, including any the site itself names.</p>
      </header>
      <div className="plg-summary">
        {list.loading ? (
          <Skeleton width={280} height={16} />
        ) : list.data ? (
          <p className="plg-summary__text">
            {count(active, "plugin")} active
            {own ? `, ${own} named by this site` : ", none named by this site"}
            {broken ? `. ${count(broken, "plugin")} ${broken === 1 ? "isn’t" : "aren’t"} working.` : "."}
          </p>
        ) : (
          <p className="plg-summary__text">The plugin list can’t be read right now.</p>
        )}
        <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/plugins`}>
          See plugins
        </Link>
      </div>
    </section>
  );
}
