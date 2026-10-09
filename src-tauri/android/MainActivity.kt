package com.phosphor.app

import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.RoundedCorner
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
  private var atStart: ScriptHandler? = null

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
  override fun onWebViewCreate(webView: WebView) {
    webView.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> publishShape(v as WebView) }
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
      for ((k, pos) in corners) vars["--corner-$k"] = css(insets.getRoundedCorner(pos)?.radius ?: 0)
    }
    val at = IntArray(2).also { wv.getLocationInWindow(it) }
    // A rect nearer the top edge than its own height is a top cutout; side ones stay env(safe-area-inset-*)'s.
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
