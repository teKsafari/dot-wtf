// Email templates for different submission statuses
export const emailTemplates = {
  approved: {
    subject: 'Welcome to dot WTF! 🎉',
    html: (name: string) => `
      <div style="font-family: monospace; background-color: #000000; color: #ffffff; padding: 20px;">
        <h1 style="color: #10B981;">Welcome to <span style="color: #EC4899;">dot WTF</span>, ${name}!</h1>
        
        <p>Congratulations! Your application has been approved and you're now officially part of the <strong>dot WTF</strong> community.</p>
        
        <h2 style="color: #10B981;">What's Next?</h2>
        <ul>
          <li>Join our Discord server: [Discord Link]</li>
          <li>Check out our upcoming build sessions</li>
          <li>Browse our project repository</li>
          <li>Start collaborating with fellow makers!</li>
        </ul>
        
        <p>We're excited to see what you'll build with us. Remember: <strong>We Tinker Fearlessly</strong>!</p>
        
        <p style="margin-top: 30px;">
          Best,<br>
          The dot WTF Team
        </p>
        
        <hr style="border-color: #374151; margin: 30px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          This email was sent to you because you applied to join dot WTF.
        </p>
      </div>
    `,
    text: (name: string) => `
Welcome to dot WTF, ${name}!

Congratulations! Your application has been approved and you're now officially part of the dot WTF community.

What's Next?
- Join our Discord server: [Discord Link]
- Check out our upcoming build sessions
- Browse our project repository
- Start collaborating with fellow makers!

We're excited to see what you'll build with us. Remember: We Tinker Fearlessly!

Best,
The dot WTF Team
    `
  },
  
  waitlisted: {
    subject: "You're on the dot WTF waitlist",
    html: (name: string) => `
      <div style="font-family: monospace; background-color: #000000; color: #ffffff; padding: 20px;">
        <h1>You're on the dot WTF waitlist, ${name}</h1>
        
        <p>We've added your application to the <strong>dot WTF</strong> waitlist.</p>
        
        <p>We'll keep your application in consideration and reach out if a spot opens. In the meantime:</p>
        <ul>
          <li>Keep building and learning</li>
          <li>Follow us on social media for updates</li>
          <li>Share what you're making with the community</li>
        </ul>
        
        <p>We're glad you're interested in the maker community, and we hope to see you around campus.</p>
        
        <p style="margin-top: 30px;">
          Best,<br>
          The dot WTF Team
        </p>
      </div>
    `,
    text: (name: string) => `
You're on the dot WTF waitlist, ${name}

We've added your application to the dot WTF waitlist.

We'll keep your application in consideration and reach out if a spot opens. In the meantime:
- Keep building and learning
- Follow us on social media for updates
- Share what you're making with the community

We're glad you're interested in the maker community, and we hope to see you around campus.

Best,
The dot WTF Team
    `
  }
};

export function getEmailTemplate(status: 'approved' | 'waitlisted', name: string) {
  const template = emailTemplates[status];
  return {
    subject: template.subject,
    html: template.html(name),
    text: template.text(name)
  };
}
