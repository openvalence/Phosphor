// Release signing and the release build's cleartext rule (docs/BUILD.md,
// Android release). Copied into gen/android/app and applied from its
// build.gradle.kts by tools/android-icons.mjs; edit this file, never the copy.
// Never put a keystore, a password or a keystore.properties in the repo.
import com.android.build.api.dsl.ApplicationExtension
import java.util.Properties

val env = System.getenv()
val props = Properties().apply {
    val f = file(env["ANDROID_KEYSTORE_PROPERTIES"]
        ?: (System.getProperty("user.home") + "/Documents/phosphor-android-signing/keystore.properties"))
    if (f.isFile) f.inputStream().use { load(it) }
}
// CI sets the ANDROID_* variables; locally keystore.properties (tools/android-keystore.mjs) holds them.
val storePath = env["ANDROID_KEYSTORE_FILE"] ?: props.getProperty("storeFile")
val storePass = env["ANDROID_KEYSTORE_PASSWORD"] ?: props.getProperty("password")
val alias = env["ANDROID_KEY_ALIAS"] ?: props.getProperty("keyAlias") ?: "phosphor"
val signed = !storePath.isNullOrBlank() && !storePass.isNullOrBlank()

configure<ApplicationExtension> {
    val release = buildTypes.getByName("release")
    // Hubs speak plain ws:// and http:// on the LAN; the template allows cleartext only in debug.
    release.manifestPlaceholders["usesCleartextTraffic"] = "true"
    if (signed) {
        release.signingConfig = signingConfigs.create("release").apply {
            storeFile = file(storePath!!)
            storePassword = storePass
            keyAlias = alias
            keyPassword = storePass
        }
    }
}

// An unsigned release only on purpose (CI without the secrets): never by a missing file.
if (!signed && env["PHOSPHOR_ANDROID_UNSIGNED"] != "1") {
    gradle.taskGraph.whenReady {
        if (allTasks.any { Regex("^(assemble|bundle)\\w*Release$").matches(it.name) }) {
            throw GradleException(
                "Phosphor release signing is not configured. Set ANDROID_KEYSTORE_FILE and " +
                "ANDROID_KEYSTORE_PASSWORD, or create the keystore with node tools/android-keystore.mjs " +
                "(keystore.properties, or ANDROID_KEYSTORE_PROPERTIES naming it). " +
                "PHOSPHOR_ANDROID_UNSIGNED=1 builds an unsigned APK on purpose."
            )
        }
    }
}
