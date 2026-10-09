# Reached only through JNI: R8 would strip them as dead code.
-keep class com.nonpolynomial.** { *; }
-keep class io.github.gedgygedgy.** { *; }
