// btleplug's Java half (its Android backend), compiled from the sources cargo
// already fetched at the version Cargo.lock pins, so the Java always matches
// the Rust that calls it. build.rs adds this module to the Android project.
plugins {
    id("com.android.library")
}

// Output goes under the generated (ignored) project, never beside this file.
layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("btleplug"))

val btleplug = Regex("""name = "btleplug"\s+version = "([^"]+)"""")
    .find(file("../../Cargo.lock").readText())!!.groupValues[1]
val cargoHome = System.getenv("CARGO_HOME") ?: (System.getProperty("user.home") + "/.cargo")
val javaSrc = file("$cargoHome/registry/src").listFiles().orEmpty()
    .map { it.resolve("btleplug-$btleplug/src/droidplug/java/src/main/java") }
    .firstOrNull { it.isDirectory }
    ?: throw GradleException("btleplug $btleplug sources not under $cargoHome/registry/src: build the Rust side first")

android {
    namespace = "com.nonpolynomial.btleplug.android"
    compileSdk = 34
    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }
    sourceSets["main"].java.srcDir(javaSrc)
}
