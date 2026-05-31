# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "BuddyTrip" [level=1] [ref=e6]:
        - img [ref=e7]
        - text: BuddyTrip
      - paragraph [ref=e9]: Welcome back
    - button "Continue with Google" [ref=e10] [cursor=pointer]:
      - img [ref=e11]
      - text: Continue with Google
    - generic [ref=e18]: or
    - button "Sign in with a magic link" [ref=e20] [cursor=pointer]:
      - img [ref=e21]
      - text: Sign in with a magic link
    - generic [ref=e26]: or
    - generic [ref=e28]:
      - generic [ref=e29]:
        - generic [ref=e30] [cursor=pointer]: Email
        - textbox "Email" [ref=e31]:
          - /placeholder: you@example.com
      - generic [ref=e32]:
        - generic [ref=e33] [cursor=pointer]: Password
        - textbox "Password" [ref=e34]:
          - /placeholder: ••••••••
      - button "Sign in" [ref=e35] [cursor=pointer]
      - button "Forgot password?" [ref=e37] [cursor=pointer]
    - paragraph [ref=e38]:
      - text: Don't have an account?
      - button "Sign up" [ref=e39] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e45] [cursor=pointer]:
    - img [ref=e46]
  - alert [ref=e49]
```