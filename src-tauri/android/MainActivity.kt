package com.phosphor.app

import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.RoundedCorner
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.math.roundToInt

// Immersive at all times (docs/DESIGN.md §10.3): system bars hidden, an edge
// swipe shows them for a moment. Copied into gen/android by
// tools/android-icons.mjs; edit this file, never the generated copy.
class MainActivity : TauriActivity() {
  private var shape = ""
  private var palette = ""
  private var atStart: ScriptHandler? = null
  private var atStartPalette: ScriptHandler? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
  }

  // A dialog, the IME or the shade can bring the bars back: hide on every focus gain.
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  // Corners and cutout change only with the window's size (rotation), which relays out the webview.
  // No overscroll stretch on the WebView itself: the whole app stretched, bars included (DESIGN §10.3).
  override fun onWebViewCreate(webView: WebView) {
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    webView.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> publishShape(v as WebView); publishPalette(v as WebView) }
    webView.addJavascriptInterface(Exit(), "PhosphorActivity")
  }

  // window.PhosphorActivity.exit(): the close gate's close (src/shell/ShellStrip.svelte), after the
  // back press that asked for it (src/model/back.js). Finishes this activity, nothing else.
  inner class Exit {
    @JavascriptInterface
    fun exit() = runOnUiThread { finish() }
  }

  // The system's wallpaper-derived palette (Material You, API 31+): the accent1 to accent3
  // and neutral1 and neutral2 tone ramps as hex, and whether the system is in night mode,
  // as window.__phosphorSystemPalette plus a 'phosphor-system-palette' event. The page's
  // Material skin reads it (src/model/dynamicColor.js); below API 31 nothing is
  // published and the skin keeps its baseline palette.
  private fun publishPalette(wv: WebView) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val tones = intArrayOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
    val ramps = linkedMapOf(
      "accent1" to intArrayOf(android.R.color.system_accent1_0, android.R.color.system_accent1_10, android.R.color.system_accent1_50,
        android.R.color.system_accent1_100, android.R.color.system_accent1_200, android.R.color.system_accent1_300, android.R.color.system_accent1_400,
        android.R.color.system_accent1_500, android.R.color.system_accent1_600, android.R.color.system_accent1_700, android.R.color.system_accent1_800,
        android.R.color.system_accent1_900, android.R.color.system_accent1_1000),
      "accent2" to intArrayOf(android.R.color.system_accent2_0, android.R.color.system_accent2_10, android.R.color.system_accent2_50,
        android.R.color.system_accent2_100, android.R.color.system_accent2_200, android.R.color.system_accent2_300, android.R.color.system_accent2_400,
        android.R.color.system_accent2_500, android.R.color.system_accent2_600, android.R.color.system_accent2_700, android.R.color.system_accent2_800,
        android.R.color.system_accent2_900, android.R.color.system_accent2_1000),
      "accent3" to intArrayOf(android.R.color.system_accent3_0, android.R.color.system_accent3_10, android.R.color.system_accent3_50,
        android.R.color.system_accent3_100, android.R.color.system_accent3_200, android.R.color.system_accent3_300, android.R.color.system_accent3_400,
        android.R.color.system_accent3_500, android.R.color.system_accent3_600, android.R.color.system_accent3_700, android.R.color.system_accent3_800,
        android.R.color.system_accent3_900, android.R.color.system_accent3_1000),
      "neutral1" to intArrayOf(android.R.color.system_neutral1_0, android.R.color.system_neutral1_10, android.R.color.system_neutral1_50,
        android.R.color.system_neutral1_100, android.R.color.system_neutral1_200, android.R.color.system_neutral1_300, android.R.color.system_neutral1_400,
        android.R.color.system_neutral1_500, android.R.color.system_neutral1_600, android.R.color.system_neutral1_700, android.R.color.system_neutral1_800,
        android.R.color.system_neutral1_900, android.R.color.system_neutral1_1000),
      "neutral2" to intArrayOf(android.R.color.system_neutral2_0, android.R.color.system_neutral2_10, android.R.color.system_neutral2_50,
        android.R.color.system_neutral2_100, android.R.color.system_neutral2_200, android.R.color.system_neutral2_300, android.R.color.system_neutral2_400,
        android.R.color.system_neutral2_500, android.R.color.system_neutral2_600, android.R.color.system_neutral2_700, android.R.color.system_neutral2_800,
        android.R.color.system_neutral2_900, android.R.color.system_neutral2_1000))
    val hex = { id: Int -> String.format("#%06X", resources.getColor(id, theme) and 0xFFFFFF) }
    val body = ramps.entries.joinToString(",") { (name, ids) ->
      "\"$name\":{" + ids.indices.joinToString(",") { "\"${tones[it]}\":\"${hex(ids[it])}\"" } + "}"
    }
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val obj = "{$body,\"night\":$night}"
    val js = "(function(p){window.__phosphorSystemPalette=p;window.dispatchEvent(new CustomEvent('phosphor-system-palette'))})($obj)"
    if (js == palette) return
    palette = js
    wv.evaluateJavascript(js, null)
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      atStartPalette?.remove()
      atStartPalette = WebViewCompat.addDocumentStartJavaScript(wv, js, setOf("*"))
    }
  }

  private fun hideSystemBars() {
    val c = WindowCompat.getInsetsController(window, window.decorView)
    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    c.hide(WindowInsetsCompat.Type.systemBars())
  }

  // The screen's rounded corners (API 31+) and top cutout (API 28+) as CSS px
  // on <html> (the vars src/style.css names), into the page now and into every
  // later load at document start. The values must stay in the webview's own
  // coordinates: offset by its place in the window, divided by the density.
  private fun publishShape(wv: WebView) {
    val insets = wv.rootWindowInsets ?: return
    val d = resources.displayMetrics.density
    val css = { px: Int -> "${(px / d).roundToInt()}px" }
    val vars = linkedMapOf<String, String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val corners = mapOf("tl" to RoundedCorner.POSITION_TOP_LEFT, "tr" to RoundedCorner.POSITION_TOP_RIGHT,
        "bl" to RoundedCorner.POSITION_BOTTOM_LEFT, "br" to RoundedCorner.POSITION_BOTTOM_RIGHT)
      val radii = corners.mapValues { (_, pos) -> insets.getRoundedCorner(pos)?.radius ?: 0 }
      for ((k, r) in radii) vars["--corner-$k"] = css(r)
      vars["--corner-r"] = css(radii.values.max())
    }
    val at = IntArray(2).also { wv.getLocationInWindow(it) }
    // A rect nearer the top edge than its own height is a top cutout. Side cutouts are not published (ph-5u0g.12, open).
    val top = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
      insets.displayCutout?.boundingRects?.firstOrNull { it.top - at[1] < it.height() } else null)
      ?.let { Rect(it).apply { offset(-at[0], -at[1]) } }
    vars["--cutout-l"] = css(top?.left ?: 0)
    vars["--cutout-r"] = css(if (top != null) wv.width - top.right else 0)
    vars["--cutout-w"] = css(top?.width() ?: 0)
    vars["--cutout-h"] = css(top?.bottom ?: 0)
    val obj = vars.entries.joinToString(",", "{", "}") { "\"${it.key}\":\"${it.value}\"" }
    val js = "(function(v,c){var go=function(){var r=document.documentElement;for(var k in v)r.style.setProperty(k,v[k]);" +
      "r.toggleAttribute('data-cutout-top',c)};if(document.documentElement)go();" +
      "else document.addEventListener('readystatechange',go,{once:true})})($obj,${top != null})"
    if (js == shape) return
    shape = js
    wv.evaluateJavascript(js, null)
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      atStart?.remove()
      atStart = WebViewCompat.addDocumentStartJavaScript(wv, js, setOf("*"))
    }
  }
}
