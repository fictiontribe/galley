// Each vendor's install snippet as its documentation shows it, with the
// placeholder id replaced by the test id. Where a vendor publishes the code
// only inside its dashboard, the shape is the one the dashboard issues (the
// README says which were checked against a public page).
export const IDS = {
  gtm: "GTM-AB12CDE3",
  ga4: "G-TEST12345",
  pixel: "123456789012345",
  linkedin: "1234567",
  hubspot: "12345678",
  munchkin: "123-ABC-456",
  plausible: "pa-AbCdEf123456",
  segment: "abcdefghijklmnop1234",
  hotjar: "1234567",
  clarity: "abcdefghij",
  intercom: "abc123de",
};

export const DOCUMENTED: Record<string, string> = {
  // support.google.com/tagmanager/answer/14847097 (current snippet)
  gtm: `<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3"></script>
<script>
window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());
</script>`,
  // …the previous version's body part, on request
  "gtm-noscript": `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-AB12CDE3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
  // developers.google.com/tag-platform/gtagjs/install + /configure
  ga4: `<script async src="https://www.googletagmanager.com/gtm.js?id=G-TEST12345"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-TEST12345');
</script>`,
  // developers.facebook.com/docs/meta-pixel/get-started
  "meta-pixel": `<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '123456789012345');
  fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=123456789012345&amp;ev=PageView&amp;noscript=1" alt=""></noscript>`,
  "linkedin-insight": `<script>
_linkedin_partner_id = "1234567";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script><script>
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
<noscript><img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=1234567&amp;fmt=gif"></noscript>`,
  hubspot: `<script type="text/javascript" id="hs-script-loader" async defer src="//js.hs-scripts.com/12345678.js"></script>`,
  // experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/leadtracking/lead-tracking
  "marketo-munchkin": `<script>
    (function() {
        var didInit = false;
        function initMunchkin() {
            if(didInit === false) {
                didInit = true;
                Munchkin.init('123-ABC-456');
            }
        }
        var s = document.createElement('script');
        s.type = 'text/javascript';
        s.async = true;
        s.src = '//munchkin.marketo.net/munchkin.js';
        s.onreadystatechange = function() {
            if (this.readyState == 'complete' || this.readyState == 'loaded') {
                initMunchkin();
            }
        };
        s.onload = initMunchkin;
        document.getElementsByTagName('head')[0].appendChild(s);
        })();
    </script>`,
  plausible: `<script async src="https://plausible.io/js/pa-AbCdEf123456.js"></script>
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init()
</script>`,
  "plausible-legacy": `<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>`,
  // twilio.com/docs/segment/…/javascript/quickstart — "Minified"
  segment: `<script>
!function(){var i="analytics",analytics=window[i]=window[i]||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","screen","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware","register"];analytics.factory=function(e){return function(){if(window[i].initialized)return window[i][e].apply(window[i],arguments);var n=Array.prototype.slice.call(arguments);if(["track","screen","alias","group","page","identify"].indexOf(e)>-1){var c=document.querySelector("link[rel='canonical']");n.push({__t:"bpc",c:c&&c.getAttribute("href")||void 0,p:location.pathname,u:location.href,s:location.search,t:document.title,r:document.referrer})}n.unshift(e);analytics.push(n);return analytics}};for(var n=0;n<analytics.methods.length;n++){var key=analytics.methods[n];analytics[key]=analytics.factory(key)}analytics.load=function(key,n){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.setAttribute("data-global-segment-analytics-key",i);t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r);analytics._loadOptions=n};analytics._writeKey="abcdefghijklmnop1234";;analytics.SNIPPET_VERSION="5.2.1";
analytics.load("abcdefghijklmnop1234");
analytics.page();
}}();
</script>`,
  hotjar: `<script>
    (function(h,o,t,j,a,r){
        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
        h._hjSettings={hjid:1234567,hjsv:6};
        a=o.getElementsByTagName('head')[0];
        r=o.createElement('script');r.async=1;
        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
        a.appendChild(r);
    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
</script>`,
  clarity: `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "abcdefghij");
</script>`,
  // developers.intercom.com/installing-intercom/web/installation (visitors, no user fields)
  intercom: `<script>
  window.intercomSettings = {
    api_base: "https://api-iam.intercom.io",
    app_id: "abc123de",
  };
</script>
<script>
(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/' + "abc123de";var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s, x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();
</script>`,
};
