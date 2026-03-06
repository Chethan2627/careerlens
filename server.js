const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const path = require('node:path');
const Groq = require('groq-sdk');

// ── PART 2: App Setup ──────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── File Upload Config ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'text/plain'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and TXT files allowed'), false);
    }
  }
});

// ── Groq Client Setup ──────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── PART 3: Extract Text from Uploaded File ────────
async function extractText(file) {
  if (file.mimetype === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(file.buffer);
    return data.text;
  } else {
    return file.buffer.toString('utf-8');
  }
}

// ── PART 4: Score Resume with Groq AI ─────────────
async function scoreResume(resumeText, targetRole, degree) {

  const prompt = `You are an expert HR professional and resume coach with 15+ years of experience hiring for ${degree} graduates in India.

The candidate is targeting: ${targetRole}

Analyze this resume and return ONLY raw JSON (no markdown, no backticks, no extra text):

RESUME:
${resumeText}

Return exactly this JSON structure:
{
  "overall_score": <number 0-100>,
  "grade": "<A+/A/A-/B+/B/B-/C+/C/C-/D/F>",
  "summary": "<2-3 sentence assessment>",
  "section_scores": {
    "contact_info": { "score": <0-10>, "feedback": "<feedback>" },
    "professional_summary": { "score": <0-10>, "feedback": "<feedback>" },
    "work_experience": { "score": <0-25>, "feedback": "<feedback>" },
    "education": { "score": <0-15>, "feedback": "<feedback>" },
    "skills": { "score": <0-20>, "feedback": "<feedback>" },
    "formatting_readability": { "score": <0-15>, "feedback": "<feedback>" },
    "keywords_ats": { "score": <0-15>, "feedback": "<feedback>" }
  },
  "strengths": [
    "<strength 1>",
    "<strength 2>",
    "<strength 3>"
  ],
  "critical_issues": [
    {
      "issue": "<title>",
      "severity": "<high/medium/low>",
      "description": "<what is wrong>",
      "fix": "<exactly how to fix>"
    }
  ],
  "step_by_step_improvements": [
    {
      "step": 1,
      "area": "<area>",
      "current_problem": "<problem>",
      "action": "<what to do>",
      "example": "<concrete example>"
    }
  ],
  "missing_sections": ["<section name>"],
  "keyword_suggestions": ["<keyword>"],
  "estimated_interview_chance": "<X>%"
}`;

  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
  });

  const responseText = result.choices[0].message.content;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response was not valid JSON');
  return JSON.parse(jsonMatch[0]);
}

// ── PART 5: Fetch Live Jobs ────────────────────────
async function fetchLiveJobs(targetRole, degree) {
  try {
    const response = await axios.get(
      'https://jsearch.p.rapidapi.com/search',
      {
        params: {
          query: `${targetRole} in India`,
          page: '1',
          num_pages: '1',
          date_posted: 'today',
          country: 'in',
        },
        headers: {
          'x-rapidapi-key': process.env.JSEARCH_API_KEY,
          'x-rapidapi-host': 'jsearch.p.rapidapi.com',
        },
      }
    );
    const jobs = response.data.data || [];
    return jobs.slice(0, 8).map((job) => ({
      title: job.job_title,
      company: job.employer_name,
      location: job.job_city + ', ' + job.job_country,
      employment_type: job.job_employment_type,
      salary: job.job_min_salary
        ? `₹${job.job_min_salary} - ₹${job.job_max_salary}`
        : 'Salary not disclosed',
      apply_link: job.job_apply_link,
      posted: job.job_posted_at_datetime_utc,
      description: job.job_description
        ? job.job_description.slice(0, 200) + '...'
        : '',
    }));
  } catch (error) {
    console.error('Jobs API error:', error.message);
    return [];
  }
}

// ── Health Check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running!' });
});

// ── PART 6: Main API Route ─────────────────────────
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded' });
    }

    const targetRole = req.body.target_role || 'Software Engineer';
    const degree     = req.body.degree || 'B.Tech';

    console.log('─────────────────────────────────');
    console.log('📄 File received:', req.file.originalname);
    console.log('🎯 Target Role  :', targetRole);
    console.log('🎓 Degree       :', degree);
    console.log('─────────────────────────────────');

    const resumeText = await extractText(req.file);

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({
        error: 'Could not read resume. Make sure PDF is not image based.'
      });
    }

    console.log('✅ Text extracted:', resumeText.length, 'characters');
    console.log('🤖 Sending to Groq AI...');

    const [analysis, jobs] = await Promise.all([
      scoreResume(resumeText, targetRole, degree),
      fetchLiveJobs(targetRole, degree),
    ]);

    console.log('✅ Score         :', analysis.overall_score + '/100');
    console.log('✅ Jobs found    :', jobs.length);
    console.log('─────────────────────────────────');

    res.json({
      success: true,
      filename: req.file.originalname,
      targetRole: targetRole,
      degree: degree,
      analysis: analysis,
      jobs: jobs,
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      error: error.message || 'Something went wrong'
    });
  }
});

// ── PART 7: Start The Server ───────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 CareerLens server started!');
  console.log('─────────────────────────────────');
  console.log('🌐 Open in browser:');
  console.log('   http://localhost:' + PORT);
  console.log('─────────────────────────────────');
  console.log('🔑 Groq API Key:',
    process.env.GROQ_API_KEY ? '✅ Found' : '❌ Missing!'
  );
  console.log('🔑 JSearch API Key:',
    process.env.JSEARCH_API_KEY ? '✅ Found' : '❌ Missing!'
  );
  console.log('─────────────────────────────────');
  console.log('');
});
