/**
 * The REST side of the invented test site: what a WordPress install answers
 * for the same posts and pages, already rendered (blocks expanded,
 * paragraphs added, shortcodes run by the plugins that are still active).
 * `{{SITE}}` is replaced with the fake server's own address.
 */
type Json = Record<string, unknown>;

const author = (id: number, name: string, slug: string) => ({ id, name, slug, url: "", description: "", link: `{{SITE}}/author/${slug}/` });
const term = (id: number, taxonomy: string, slug: string, name: string) => ({ id, taxonomy, slug, name, link: `{{SITE}}/${taxonomy === "category" ? "category" : "tag"}/${slug}/` });
const media = (id: number, file: string, alt: string, sizes: Record<string, string> = {}) => ({
  id,
  date: "2024-03-01T10:00:00",
  date_gmt: "2024-03-01T10:00:00",
  slug: file.split("/").pop()!.replace(/\.\w+$/, ""),
  type: "attachment",
  link: `{{SITE}}/?attachment_id=${id}`,
  title: { rendered: file.split("/").pop()!.replace(/\.\w+$/, "") },
  alt_text: alt,
  caption: { rendered: "" },
  media_type: "image",
  mime_type: "image/png",
  media_details: { width: 1200, height: 800, sizes: Object.fromEntries(Object.entries(sizes).map(([name, url]) => [name, { source_url: `{{SITE}}/wp-content/uploads/${url}` }])) },
  post: null,
  source_url: `{{SITE}}/wp-content/uploads/${file}`,
});

const embedded = (authorId: number, mediaItem: Json | null, terms: Json[][]) => ({
  author: [authorId === 1 ? author(1, "Ana Whitcombe", "ana") : author(2, "Sam Okoro", "sam")],
  ...(mediaItem ? { "wp:featuredmedia": [mediaItem] } : {}),
  "wp:term": terms,
});

const yoast = (title: string, description: string, link: string) => ({ title: `${title} – Quillfield Pottery`, description, canonical: link, robots: { index: "index", follow: "follow" }, og_title: title });

export const POSTS: Json[] = [
  {
    id: 103,
    date: "2024-04-12T16:00:00",
    date_gmt: "2024-04-12T15:00:00",
    modified: "2024-04-12T16:00:00",
    modified_gmt: "2024-04-12T15:00:00",
    slug: "studio-diary-spring-term",
    status: "publish",
    type: "post",
    link: "{{SITE}}/2024/04/studio-diary-spring-term/",
    title: { rendered: "Studio diary: spring term" },
    content: {
      rendered: `<p>A few things from this term&#8217;s shelf.</p>
<div id='gallery-1' class='gallery galleryid-103 gallery-columns-2 gallery-size-thumbnail'><figure class='gallery-item'><div class='gallery-icon landscape'><a href='{{SITE}}/wp-content/uploads/2024/04/bowl.png'><img width="150" height="150" src="{{SITE}}/wp-content/uploads/2024/04/bowl-150x150.png" class="attachment-thumbnail size-thumbnail" alt="A speckled bowl" /></a></div><figcaption class='wp-caption-text gallery-caption'>Speckled bowl</figcaption></figure><figure class='gallery-item'><div class='gallery-icon landscape'><a href='{{SITE}}/wp-content/uploads/2024/04/mugs.png'><img width="150" height="150" src="{{SITE}}/wp-content/uploads/2024/04/mugs-150x150.png" class="attachment-thumbnail size-thumbnail" alt="Four mugs in a row" /></a></div></figure></div>
<p>How we wedge clay:</p>
<p><iframe loading="lazy" title="Wedging clay" src="https://player.vimeo.com/video/76979871?dnt=1&amp;app_id=122963" width="500" height="281" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></p>
<p>Sign up for the spring list: [newsletter_signup list=&#8221;spring&#8221;]</p>
<div class="wpcf7 no-js" id="wpcf7-f5-p103-o1"><form action="/2024/04/studio-diary-spring-term/#wpcf7-f5-p103-o1" method="post" class="wpcf7-form init" aria-label="Contact form"><p><label> Your name<br /><input type="text" name="your-name" /></label></p></form></div>
<script src="{{SITE}}/wp-content/plugins/tracker.js"></script>`,
      protected: false,
    },
    excerpt: { rendered: "<p>A few things from this term&#8217;s shelf. How we wedge clay: Sign up for the spring list: [&hellip;]</p>\n", protected: false },
    author: 1,
    featured_media: 0,
    comment_status: "open",
    sticky: false,
    template: "",
    categories: [11],
    tags: [22],
    yoast_head_json: yoast("Studio diary: spring term", "What we made, broke and learned in the spring term.", "{{SITE}}/2024/04/studio-diary-spring-term/"),
    _embedded: embedded(1, null, [[term(11, "category", "news", "News")], [term(22, "post_tag", "studio", "studio")]]),
  },
  {
    id: 102,
    date: "2024-03-20T09:30:00",
    date_gmt: "2024-03-20T09:30:00",
    modified: "2024-04-02T12:00:00",
    modified_gmt: "2024-04-02T12:00:00",
    slug: "glaze-notes",
    status: "publish",
    type: "post",
    link: "{{SITE}}/2024/03/glaze-notes/",
    title: { rendered: "Glaze notes: three recipes we keep coming back to" },
    content: {
      rendered: `<p>Three glazes do most of the work in this studio.</p>
<h2 class="wp-block-heading">The recipes</h2>
<ol class="wp-block-list"><li>Celadon<ul class="wp-block-list"><li>Pools in carved lines</li></ul></li><li>Tenmoku</li></ol>
<figure class="wp-block-image size-large"><img decoding="async" src="{{SITE}}/wp-content/uploads/2024/04/throwing-1024x683.png" alt="Hands on a wheel" class="wp-image-205" srcset="{{SITE}}/wp-content/uploads/2024/04/throwing-1024x683.png 1024w, {{SITE}}/wp-content/uploads/2024/04/throwing-300x200.png 300w" sizes="(max-width: 1024px) 100vw, 1024px" /><figcaption class="wp-element-caption">Throwing a test bowl</figcaption></figure>
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">
<iframe title="A firing in four minutes" width="500" height="281" src="https://www.youtube.com/embed/Zq3fR2b8kXw?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div></figure>
<p>Read about <a href="{{SITE}}/2024/04/studio-diary-spring-term/">the spring term</a>.</p>`,
      protected: false,
    },
    excerpt: { rendered: "<p>Three glazes do most of the work in this studio. The recipes Celadon Pools in carved lines Tenmoku [&hellip;]</p>\n", protected: false },
    author: 2,
    featured_media: 202,
    comment_status: "open",
    sticky: false,
    template: "",
    categories: [13],
    tags: [23],
    yoast_head_json: yoast("Glaze notes", "Celadon, tenmoku and a reliable clear: the three glazes we use most.", "{{SITE}}/2024/03/glaze-notes/"),
    _embedded: embedded(2, media(202, "2024/03/glaze-tiles.png", "Test tiles in three glazes", { medium: "2024/03/glaze-tiles-300x200.png" }), [[term(13, "category", "beginners", "Beginners")], [term(23, "post_tag", "glaze", "glaze")]]),
  },
  {
    id: 101,
    date: "2024-03-05T10:00:00",
    date_gmt: "2024-03-05T10:00:00",
    modified: "2024-03-05T10:00:00",
    modified_gmt: "2024-03-05T10:00:00",
    slug: "opening-the-new-kiln-room",
    status: "publish",
    type: "post",
    link: "{{SITE}}/2024/03/opening-the-new-kiln-room/",
    title: { rendered: "Opening the new kiln room" },
    content: {
      rendered: `<p>The new kiln arrived on a Tuesday &amp; it took four of us to carry it in. It&#8217;s the first &#8220;proper&#8221; kiln we&#8217;ve owned.</p>
<p><span id="more-101"></span></p>
<div id="attachment_201" style="width: 310px" class="wp-caption aligncenter"><a href="{{SITE}}/wp-content/uploads/2024/03/kiln-room.png"><img aria-describedby="caption-attachment-201" class="size-medium wp-image-201" src="{{SITE}}/wp-content/uploads/2024/03/kiln-room-300x200.png" alt="The kiln room with its new kiln" width="300" height="200" /></a><p id="caption-attachment-201" class="wp-caption-text">The kiln room, the week it opened</p></div>
<p>Read our <a href="{{SITE}}/2024/03/glaze-notes/">glaze notes</a> before your first firing, or browse the <a href="{{SITE}}/shop/">shop</a>.</p>`,
      protected: false,
    },
    excerpt: { rendered: "<p>The new kiln arrived on a Tuesday &amp; it took four of us to carry it in. It&#8217;s the first &#8220;proper&#8221; kiln we&#8217;ve owned.</p>\n", protected: false },
    author: 1,
    featured_media: 201,
    comment_status: "open",
    sticky: false,
    template: "",
    categories: [11],
    tags: [21, 22],
    yoast_head_json: yoast("Opening the new kiln room", "Our new kiln room is open: what changed, and how firing works from April.", "{{SITE}}/2024/03/opening-the-new-kiln-room/"),
    _embedded: embedded(1, media(201, "2024/03/kiln-room.png", "The kiln room with its new kiln", { medium: "2024/03/kiln-room-300x200.png" }), [[term(11, "category", "news", "News")], [term(21, "post_tag", "kiln", "kiln"), term(22, "post_tag", "studio", "studio")]]),
  },
];

const ELEMENTOR_PAGE = `<div data-elementor-type="wp-page" data-elementor-id="304" class="elementor elementor-304" data-elementor-post-type="page">
<section class="elementor-section elementor-top-section elementor-element elementor-element-a1 elementor-section-boxed elementor-section-height-default" data-id="a1" data-element_type="section" id="intro">
<div class="elementor-container elementor-column-gap-default">
<div class="elementor-column elementor-col-100 elementor-top-column elementor-element elementor-element-a2" data-id="a2" data-element_type="column">
<div class="elementor-widget-wrap elementor-element-populated">
<div class="elementor-element elementor-element-a3 elementor-widget elementor-widget-heading" data-id="a3" data-element_type="widget" data-widget_type="heading.default">
<div class="elementor-widget-container"><h1 class="elementor-heading-title elementor-size-default">Make something with your hands</h1></div></div>
<div class="elementor-element elementor-element-a4 elementor-widget elementor-widget-text-editor" data-id="a4" data-element_type="widget" data-widget_type="text-editor.default">
<div class="elementor-widget-container"><p>Evening and weekend classes for complete beginners and returning potters.</p></div></div>
<div class="elementor-element elementor-element-a5 elementor-align-center elementor-widget elementor-widget-button" data-id="a5" data-element_type="widget" data-widget_type="button.default">
<div class="elementor-widget-container"><div class="elementor-button-wrapper"><a class="elementor-button elementor-button-link elementor-size-sm" href="{{SITE}}/opening-hours/"><span class="elementor-button-content-wrapper"><span class="elementor-button-text">Book a class</span></span></a></div></div></div>
</div></div></div></section>
<section class="elementor-section elementor-top-section elementor-element elementor-element-b1" data-id="b1" data-element_type="section">
<div class="elementor-container elementor-column-gap-default">
<div class="elementor-column elementor-col-33 elementor-top-column elementor-element" data-element_type="column"><div class="elementor-widget-wrap elementor-element-populated">
<div class="elementor-element elementor-widget elementor-widget-icon-box" data-element_type="widget" data-widget_type="icon-box.default"><div class="elementor-widget-container"><div class="elementor-icon-box-wrapper"><div class="elementor-icon-box-icon"><span class="elementor-icon elementor-animation-"><i aria-hidden="true" class="fas fa-hand-paper"></i></span></div><div class="elementor-icon-box-content"><h3 class="elementor-icon-box-title"><span>Throwing</span></h3><p class="elementor-icon-box-description">Learn to centre, open and pull a cylinder.</p></div></div></div></div>
</div></div>
<div class="elementor-column elementor-col-33 elementor-top-column elementor-element" data-element_type="column"><div class="elementor-widget-wrap elementor-element-populated">
<div class="elementor-element elementor-widget elementor-widget-icon-box" data-element_type="widget" data-widget_type="icon-box.default"><div class="elementor-widget-container"><div class="elementor-icon-box-wrapper"><div class="elementor-icon-box-icon"><span class="elementor-icon"><i aria-hidden="true" class="fas fa-shapes"></i></span></div><div class="elementor-icon-box-content"><h3 class="elementor-icon-box-title"><span>Hand-building</span></h3><p class="elementor-icon-box-description">Pinch, coil and slab pots.</p></div></div></div></div>
</div></div>
<div class="elementor-column elementor-col-33 elementor-top-column elementor-element" data-element_type="column"><div class="elementor-widget-wrap elementor-element-populated">
<div class="elementor-element elementor-widget elementor-widget-icon-box" data-element_type="widget" data-widget_type="icon-box.default"><div class="elementor-widget-container"><div class="elementor-icon-box-wrapper"><div class="elementor-icon-box-icon"><span class="elementor-icon"><i aria-hidden="true" class="fas fa-fill-drip"></i></span></div><div class="elementor-icon-box-content"><h3 class="elementor-icon-box-title"><span>Glazing</span></h3><p class="elementor-icon-box-description">Mix, dip and layer glazes.</p></div></div></div></div>
</div></div>
</div></section>
<div class="elementor-element elementor-element-c1 e-flex e-con-boxed e-con e-parent" data-id="c1" data-element_type="container">
<div class="e-con-inner">
<div class="elementor-element elementor-widget elementor-widget-testimonial" data-element_type="widget" data-widget_type="testimonial.default"><div class="elementor-widget-container"><div class="elementor-testimonial-wrapper"><div class="elementor-testimonial-content">I came for one evening and stayed for three terms.</div><div class="elementor-testimonial-meta elementor-has-image"><div class="elementor-testimonial-meta-inner"><div class="elementor-testimonial-image"><img src="{{SITE}}/wp-content/uploads/2024/02/mara-150x150.png" alt="Mara at the wheel"></div><div class="elementor-testimonial-details"><div class="elementor-testimonial-name">Mara Ellison</div><div class="elementor-testimonial-job">Weekend class, 2024</div></div></div></div></div></div></div>
</div></div>
<div class="elementor-element elementor-element-d1 e-flex e-con-boxed e-con e-parent" data-element_type="container">
<div class="e-con-inner">
<div class="elementor-element elementor-widget elementor-widget-heading" data-element_type="widget" data-widget_type="heading.default"><div class="elementor-widget-container"><h2 class="elementor-heading-title">Questions people ask</h2></div></div>
<div class="elementor-element elementor-widget elementor-widget-accordion" data-element_type="widget" data-widget_type="accordion.default"><div class="elementor-widget-container"><div class="elementor-accordion">
<div class="elementor-accordion-item"><div id="elementor-tab-title-1" class="elementor-tab-title" data-tab="1" role="button" aria-controls="elementor-tab-content-1"><a class="elementor-accordion-title" href="">Do I need any experience?</a></div><div id="elementor-tab-content-1" class="elementor-tab-content elementor-clearfix" data-tab="1" role="region"><p>None at all.</p></div></div>
<div class="elementor-accordion-item"><div id="elementor-tab-title-2" class="elementor-tab-title" data-tab="2" role="button" aria-controls="elementor-tab-content-2"><a class="elementor-accordion-title" href="">What should I wear?</a></div><div id="elementor-tab-content-2" class="elementor-tab-content elementor-clearfix" data-tab="2" role="region"><p>Clothes you don&#8217;t mind getting muddy.</p></div></div>
</div></div></div>
</div></div>
<div class="elementor-element elementor-element-g1 e-flex e-con-boxed e-con e-parent" data-element_type="container">
<div class="e-con-inner">
<div class="elementor-element elementor-widget elementor-widget-form" data-element_type="widget" data-widget_type="form.default"><div class="elementor-widget-container"><form class="elementor-form" method="post" name="Class enquiry"><div class="elementor-form-fields-wrapper"><div class="elementor-field-group"><label for="form-field-name" class="elementor-field-label">Name</label><input type="text" id="form-field-name"></div><div class="elementor-field-group"><label for="form-field-email" class="elementor-field-label">Email</label><input type="email" id="form-field-email"></div></div></form></div></div>
</div></div>
</div>`;

export const PAGES: Json[] = [
  {
    id: 304,
    date: "2024-02-01T09:00:00",
    date_gmt: "2024-02-01T09:00:00",
    modified_gmt: "2024-02-01T09:00:00",
    slug: "classes",
    status: "publish",
    type: "page",
    link: "{{SITE}}/classes/",
    title: { rendered: "Classes" },
    content: { rendered: ELEMENTOR_PAGE, protected: false },
    excerpt: { rendered: "<p>Make something with your hands Evening and weekend classes [&hellip;]</p>", protected: false },
    author: 1,
    featured_media: 0,
    parent: 0,
    menu_order: 0,
    template: "elementor_header_footer",
    _embedded: embedded(1, null, []),
  },
  {
    id: 301,
    date: "2024-01-10T09:00:00",
    date_gmt: "2024-01-10T09:00:00",
    modified_gmt: "2024-01-10T09:00:00",
    slug: "opening-hours",
    status: "publish",
    type: "page",
    link: "{{SITE}}/opening-hours/",
    title: { rendered: "Opening hours" },
    content: { rendered: "<p>We&#8217;re open Tuesday to Saturday.</p>\n<p>Tuesday&#8211;Friday: 10:00&#8211;18:00<br />\nSaturday: 09:00&#8211;13:00</p>\n", protected: false },
    excerpt: { rendered: "", protected: false },
    author: 1,
    featured_media: 0,
    parent: 0,
    menu_order: 0,
    template: "",
    yoast_head_json: yoast("Opening hours", "When the studio is open, and when it closes for the summer.", "{{SITE}}/opening-hours/"),
    _embedded: embedded(1, null, []),
  },
];

export const CATEGORIES: Json[] = [
  { id: 11, name: "News", slug: "news", parent: 0, taxonomy: "category", link: "{{SITE}}/category/news/" },
  { id: 12, name: "Workshops", slug: "workshops", parent: 0, taxonomy: "category", link: "{{SITE}}/category/workshops/" },
  { id: 13, name: "Beginners", slug: "beginners", parent: 12, taxonomy: "category", link: "{{SITE}}/category/workshops/beginners/" },
];

export const TYPES: Json = {
  post: { name: "Posts", slug: "post", rest_base: "posts", rest_namespace: "wp/v2" },
  page: { name: "Pages", slug: "page", rest_base: "pages", rest_namespace: "wp/v2" },
  attachment: { name: "Media", slug: "attachment", rest_base: "media", rest_namespace: "wp/v2" },
  wp_block: { name: "Patterns", slug: "wp_block", rest_base: "blocks", rest_namespace: "wp/v2" },
  course: { name: "Courses", slug: "course", rest_base: "courses", rest_namespace: "wp/v2" },
};

export const COURSES: Json[] = [
  { id: 401, date: "2024-02-10T09:00:00", date_gmt: "2024-02-10T09:00:00", slug: "beginners-wheel", status: "publish", type: "course", link: "{{SITE}}/course/beginners-wheel/", title: { rendered: "Beginners wheel course" }, content: { rendered: "<p>Six weeks on the wheel.</p>", protected: false }, excerpt: { rendered: "" }, author: 1, featured_media: 0 },
];

export const INDEX: Json = {
  name: "Quillfield Pottery",
  description: "A small pottery studio with classes",
  url: "{{SITE}}",
  home: "{{SITE}}",
  namespaces: ["oembed/1.0", "wp/v2", "wp-site-health/v1", "yoast/v1", "contact-form-7/v1"],
  routes: {},
};
